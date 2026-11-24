import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, getRecord, getSessionUser, handleApiError, listRecords, nowIso, readJson, setRecord, writeAssetHistory, writeAudit } from "@/lib/api";

const defaultCategories = ["Veículo", "Computador", "Equipamento", "Outro"];
const defaultStatuses = ["Em uso", "Disponível", "Em manutenção", "Baixado"];
export const runtime = "nodejs";
const dateIsValid = (value: string) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const assets = (await listRecords("assets", { organization_id: user.organizationId }))
      .filter((asset) => user.role === "admin" || asset.owner_uid === user.uid)
      .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
    const owners = await listRecords("users", { organization_id: user.organizationId });
    const photos = await listRecords("asset_photos");
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
    const items = assets.map((asset) => {
      const owner = ownerMap.get(String(asset.owner_uid));
      const cover = photos.filter((photo) => photo.asset_id === asset.id)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
      const visibleAsset = user.role === "admin" ? asset : {
        ...asset,
        purchase_date: "",
        purchase_cost: 0,
        warranty_until: "",
      };
      return {
        ...visibleAsset,
        nextMaintenance: visibleAsset.next_maintenance,
        ownerUid: visibleAsset.owner_uid,
        ownerEmail: owner?.email ?? "",
        ownerName: owner?.display_name ?? "",
        createdAt: asset.created_at,
        updatedAt: asset.updated_at,
        serialNumber: asset.serial_number,
        purchaseDate: visibleAsset.purchase_date,
        purchaseCost: visibleAsset.purchase_cost,
        warrantyUntil: visibleAsset.warranty_until,
        vehicleKm: asset.vehicle_km,
        usageHours: asset.usage_hours,
        lastMaintenanceKm: asset.last_maintenance_km,
        unitId: asset.unit_id,
        coverPhotoId: cover?.id ?? null,
      };
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(request);
    const body = await readJson(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const category = typeof body.category === "string" ? body.category : "";
    const tag = typeof body.tag === "string" ? body.tag.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const status = typeof body.status === "string" ? body.status : "Em uso";
    const nextMaintenance = typeof body.nextMaintenance === "string" ? body.nextMaintenance.trim() : "";
    const requestedOwnerUid = typeof body.ownerUid === "string" ? body.ownerUid.trim() : "";
    const unitId = user.role === "admin" && typeof body.unitId === "string" ? body.unitId.trim() : "";
    const manufacturer = typeof body.manufacturer === "string" ? body.manufacturer.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const serialNumber = typeof body.serialNumber === "string" ? body.serialNumber.trim() : "";
    const purchaseDate = typeof body.purchaseDate === "string" ? body.purchaseDate.trim() : "";
    const warrantyUntil = typeof body.warrantyUntil === "string" ? body.warrantyUntil.trim() : "";
    const purchaseCost = typeof body.purchaseCost === "number" ? body.purchaseCost : 0;
    const vehicleKm = typeof body.vehicleKm === "number" ? body.vehicleKm : null;
    const usageHours = typeof body.usageHours === "number" ? body.usageHours : null;
    if (!name || name.length > 120) throw new ApiError(400, "Nome inválido.");
    const [categories, statuses] = await Promise.all([
      listRecords("asset_categories", { organization_id: user.organizationId }),
      listRecords("asset_statuses", { organization_id: user.organizationId }),
    ]);
    if (![...defaultCategories, ...categories.map((item) => item.name)].includes(category)) throw new ApiError(400, "Categoria inválida.");
    if (![...defaultStatuses, ...statuses.map((item) => item.name)].includes(status)) throw new ApiError(400, "Situação inválida.");
    if (tag.length > 80 || location.length > 120 || nextMaintenance.length > 10) throw new ApiError(400, "Um ou mais campos excedem o limite permitido.");
    if (!dateIsValid(nextMaintenance)) throw new ApiError(400, "Informe uma data válida para a próxima preventiva.");
    if (body.details !== undefined &&
      (!body.details || typeof body.details !== "object" || Array.isArray(body.details) || JSON.stringify(body.details).length > 10_000)) {
      throw new ApiError(400, "Detalhes do ativo inválidos ou muito extensos.");
    }
    let ownerUid = user.uid;
    if (user.role === "admin" && requestedOwnerUid) {
      const owner = await getRecord("users", requestedOwnerUid);
      if (!owner || owner.organization_id !== user.organizationId || !owner.active) throw new ApiError(400, "Selecione um responsável válido.");
      ownerUid = owner.id;
    }
    if (user.role === "admin" && unitId) {
      const unit = await getRecord("units", unitId);
      if (!unit || unit.organization_id !== user.organizationId) throw new ApiError(400, "Selecione uma unidade válida.");
    }
    if ([manufacturer, model, serialNumber].some((value) => value.length > 120)) throw new ApiError(400, "Fabricante, modelo e número de série devem ter até 120 caracteres.");
    if (!Number.isFinite(purchaseCost) || purchaseCost < 0 || purchaseCost > 1_000_000_000) throw new ApiError(400, "Informe um custo de aquisição válido.");
    if (vehicleKm !== null && (!Number.isInteger(vehicleKm) || vehicleKm < 0)) throw new ApiError(400, "Informe uma quilometragem válida.");
    if (usageHours !== null && (!Number.isInteger(usageHours) || usageHours < 0)) throw new ApiError(400, "Informe horas de uso válidas.");
    if (!dateIsValid(purchaseDate) || !dateIsValid(warrantyUntil)) throw new ApiError(400, "Informe datas válidas para compra e garantia.");

    const id = randomUUID();
    const timestamp = nowIso();
    await setRecord("assets", id, {
      name, category, tag, location, status, next_maintenance: nextMaintenance, owner_uid: ownerUid,
      organization_id: user.organizationId, unit_id: unitId || null, manufacturer, model,
      serial_number: serialNumber, purchase_date: purchaseDate, purchase_cost: purchaseCost,
      warranty_until: warrantyUntil, vehicle_km: vehicleKm, usage_hours: usageHours,
      last_maintenance_km: null, details_json: JSON.stringify(body.details ?? {}),
      created_at: timestamp, updated_at: timestamp,
    });
    await writeAssetHistory(id, user.uid, "created", "Ativo cadastrado.", { ownerUid, status });
    await writeAudit(user.organizationId, user.uid, "asset.created", "asset", id, { name, category, ownerUid });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
