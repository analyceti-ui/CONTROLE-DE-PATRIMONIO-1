import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readImageUploads } from "@/lib/asset-photos";
import { ApiError, getFirestoreDb, getSessionUser, handleApiError, listRecords, nowIso, organizationScopedAsset, writeAssetHistory, writeAudit } from "@/lib/api";
import { deleteImage, uploadImage } from "@/lib/cloudinary";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser(request);
    const { id } = await context.params;
    const asset = await organizationScopedAsset(user, id);
    if (asset.category !== "Veículo") throw new ApiError(400, "O registro de abastecimento está disponível apenas para veículos.");
    const [records, users, orders] = await Promise.all([
      listRecords("vehicle_fuel_records", { asset_id: id }),
      listRecords("users", { organization_id: user.organizationId }),
      listRecords("service_orders", { asset_id: id }),
    ]);
    const people = new Map(users.map((person) => [person.id, person]));
    const result = records.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 500).map((record) => ({
        id: record.id, odometerKm: record.odometer_km, previousOdometerKm: record.previous_odometer_km,
        distanceKm: record.distance_km, amount: record.amount, odometerPhotoType: record.odometer_photo_type,
        receiptPhotoType: record.receipt_photo_type, createdAt: record.created_at,
        userName: people.get(String(record.user_uid))?.display_name ?? "",
      }));
    return NextResponse.json({
      records: result,
      assetState: { vehicleKm: asset.vehicle_km ?? null, lastMaintenanceKm: asset.last_maintenance_km ?? null },
      maintenanceHistory: orders.filter((order) => ["Preventiva", "Corretiva"].includes(String(order.kind)) && order.status === "Concluída")
        .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))).slice(0, 100)
        .map((order) => ({
          id: order.id, kind: order.kind, description: order.description, odometerKm: order.odometer_km,
          maintenanceDistanceKm: order.maintenance_distance_km, completedAt: order.completed_at,
        })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const uploaded: Array<{ public_id: string }> = [];
  let committed = false;
  try {
    const user = await getSessionUser(request);
    const { id } = await context.params;
    const asset = await organizationScopedAsset(user, id);
    if (asset.category !== "Veículo") throw new ApiError(400, "O registro de abastecimento está disponível apenas para veículos.");
    const form = await request.formData();
    const odometerKm = Number(form.get("odometerKm"));
    const amount = Number(String(form.get("amount") ?? "").replace(",", "."));
    if (!Number.isSafeInteger(odometerKm) || odometerKm < 0) throw new ApiError(400, "Informe uma quilometragem inteira válida.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new ApiError(400, "Informe um valor de abastecimento maior que zero.");
    const odometerPhotos = await readImageUploads(form, "odometerPhoto");
    const receiptPhotos = await readImageUploads(form, "receiptPhoto");
    if (odometerPhotos.length !== 1 || receiptPhotos.length !== 1) throw new ApiError(400, "Anexe exatamente uma foto do hodômetro e uma foto do cupom.");
    if (odometerPhotos[0].blob.length + receiptPhotos[0].blob.length > 3.5 * 1024 * 1024) {
      throw new ApiError(400, "As duas fotos devem somar até 3,5 MB para o envio seguro.");
    }
    const odo = await uploadImage(odometerPhotos[0].blob, odometerPhotos[0].type, `${user.organizationId}/assets/${id}/fuel`);
    uploaded.push(odo);
    const receipt = await uploadImage(receiptPhotos[0].blob, receiptPhotos[0].type, `${user.organizationId}/assets/${id}/fuel`);
    uploaded.push(receipt);

    const db = getFirestoreDb();
    const recordId = randomUUID();
    const timestamp = nowIso();
    let previousOdometerKm = 0;
    let distanceKm = 0;
    await db.runTransaction(async (transaction) => {
      const assetRef = db.collection("assets").doc(id);
      const [assetSnap, history] = await Promise.all([
        transaction.get(assetRef),
        transaction.get(db.collection("vehicle_fuel_records").where("asset_id", "==", id)),
      ]);
      if (!assetSnap.exists || assetSnap.data()?.organization_id !== user.organizationId) throw new ApiError(404, "Veículo não encontrado.");
      const currentAsset = assetSnap.data()!;
      const prior = history.docs.map((doc) => doc.data()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      previousOdometerKm = Number(prior?.odometer_km ?? currentAsset.vehicle_km ?? 0);
      if (odometerKm < previousOdometerKm) {
        throw new ApiError(409, `A quilometragem precisa ser igual ou maior que a última registrada (${previousOdometerKm.toLocaleString("pt-BR")} km).`);
      }
      distanceKm = odometerKm - previousOdometerKm;
      transaction.create(db.collection("vehicle_fuel_records").doc(recordId), {
        asset_id: id, user_uid: user.uid, odometer_km: odometerKm, previous_odometer_km: previousOdometerKm,
        distance_km: distanceKm, amount, odometer_photo_public_id: odo.public_id,
        odometer_photo_type: odometerPhotos[0].type, receipt_photo_public_id: receipt.public_id,
        receipt_photo_type: receiptPhotos[0].type, created_at: timestamp,
      });
      transaction.update(assetRef, {
        vehicle_km: odometerKm,
        last_maintenance_km: currentAsset.last_maintenance_km ?? previousOdometerKm,
        updated_at: timestamp,
      });
    });
    committed = true;
    await writeAssetHistory(id, user.uid, "vehicle.fueled", "Abastecimento e quilometragem registrados.", {
      odometerKm, previousOdometerKm, distanceKm, amount,
    });
    await writeAudit(user.organizationId, user.uid, "vehicle.fueled", "asset", id, { odometerKm, distanceKm, amount });
    return NextResponse.json({ ok: true, odometerKm, previousOdometerKm, distanceKm }, { status: 201 });
  } catch (error) {
    if (!committed) await Promise.all(uploaded.map((photo) => deleteImage(photo.public_id).catch(() => undefined)));
    return handleApiError(error);
  }
}
