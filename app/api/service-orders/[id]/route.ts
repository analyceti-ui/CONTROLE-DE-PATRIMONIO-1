import { NextResponse } from "next/server";
import { ApiError, getFirestoreDb, getSessionUser, handleApiError, nowIso, readJson, requireOrganizationUser, writeAssetHistory, writeAudit } from "@/lib/api";

type RouteContext = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
const statuses = new Set(["Aberta", "Em andamento", "Aguardando peça", "Concluída", "Cancelada"]);

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser(request);
    const { id } = await context.params;
    const body = await readJson(request);
    const db = getFirestoreDb();
    const orderRef = db.collection("service_orders").doc(id);
    let order: FirebaseFirestore.DocumentData | undefined;
    let organizationId = "";
    let assetId = "";
    let resultingStatus = "";
    await db.runTransaction(async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) throw new ApiError(404, "Ordem de serviço não encontrada.");
      const current = orderSnap.data()!;
      assetId = String(current.asset_id);
      const assetRef = db.collection("assets").doc(assetId);
      const [assetSnap, planQuery] = await Promise.all([
        transaction.get(assetRef),
        transaction.get(db.collection("maintenance_plans").where("asset_id", "==", assetId)),
      ]);
      if (!assetSnap.exists) throw new ApiError(404, "Ativo da ordem não encontrado.");
      const asset = assetSnap.data()!;
      organizationId = String(asset.organization_id);
      requireOrganizationUser(user, organizationId);
      if (user.role !== "admin" && asset.owner_uid !== user.uid) throw new ApiError(403, "Você não pode alterar esta ordem de serviço.");
      resultingStatus = typeof body.status === "string" ? body.status : String(current.status);
      if (!statuses.has(resultingStatus)) throw new ApiError(400, "Situação da ordem inválida.");
      const laborCost = body.laborCost === undefined ? Number(current.labor_cost ?? 0) : Number(body.laborCost);
      const partsCost = body.partsCost === undefined ? Number(current.parts_cost ?? 0) : Number(body.partsCost);
      if (body.invoiceNumber !== undefined && typeof body.invoiceNumber !== "string") {
        throw new ApiError(400, "Informe um número de nota fiscal válido.");
      }
      const invoiceNumber = body.invoiceNumber === undefined
        ? String(current.invoice_number ?? "")
        : body.invoiceNumber.trim();
      const odometerKm = body.odometerKm === undefined ? (current.odometer_km == null ? null : Number(current.odometer_km))
        : body.odometerKm === null ? null : Number(body.odometerKm);
      const hoursUsed = body.hoursUsed === undefined ? (current.hours_used == null ? null : Number(current.hours_used))
        : body.hoursUsed === null ? null : Number(body.hoursUsed);
      if ([laborCost, partsCost].some((value) => !Number.isFinite(value) || value < 0)) throw new ApiError(400, "Informe custos válidos.");
      if (invoiceNumber.length > 100) throw new ApiError(400, "O número da nota fiscal deve ter até 100 caracteres.");
      if (odometerKm !== null && (!Number.isInteger(odometerKm) || odometerKm < 0)) throw new ApiError(400, "Quilometragem inválida.");
      if (hoursUsed !== null && (!Number.isInteger(hoursUsed) || hoursUsed < 0)) throw new ApiError(400, "Horas de uso inválidas.");
      const completing = resultingStatus === "Concluída" && current.status !== "Concluída" && current.kind !== "Inspeção";
      const currentVehicleKm = asset.vehicle_km == null ? null : Number(asset.vehicle_km);
      if (completing && odometerKm !== null && currentVehicleKm !== null && odometerKm < currentVehicleKm) {
        throw new ApiError(409, `A quilometragem da manutenção não pode ser menor que a última registrada (${currentVehicleKm.toLocaleString("pt-BR")} km).`);
      }
      let maintenanceDistanceKm = current.maintenance_distance_km ?? null;
      const assetChanges: Record<string, unknown> = { updated_at: nowIso() };
      const planSnap = planQuery.docs[0];
      let planChanges: Record<string, unknown> | null = null;
      if (completing) {
        const completionOdometer = odometerKm ?? currentVehicleKm;
        if (completionOdometer !== null) {
          const cycleStart = asset.last_maintenance_km ?? currentVehicleKm ?? completionOdometer;
          maintenanceDistanceKm = Math.max(0, completionOdometer - Number(cycleStart));
          assetChanges.vehicle_km = Math.max(currentVehicleKm ?? 0, completionOdometer);
          assetChanges.last_maintenance_km = completionOdometer;
        }
        if (current.kind === "Preventiva" && planSnap) {
          const plan = planSnap.data();
          planChanges = { updated_at: nowIso(), last_completed: new Date().toISOString().slice(0, 10) };
          if (plan.interval_days) {
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + Number(plan.interval_days));
            assetChanges.next_maintenance = nextDate.toISOString().slice(0, 10);
          }
          if (plan.interval_km && odometerKm !== null) planChanges.next_due_km = odometerKm + Number(plan.interval_km);
          if (plan.interval_hours && hoursUsed !== null) planChanges.next_due_hours = hoursUsed + Number(plan.interval_hours);
          if (hoursUsed !== null) assetChanges.usage_hours = hoursUsed;
        }
      }
      const updates = {
        status: resultingStatus, labor_cost: laborCost, parts_cost: partsCost,
        invoice_number: invoiceNumber || null,
        odometer_km: odometerKm, hours_used: hoursUsed,
        maintenance_distance_km: maintenanceDistanceKm,
        completed_at: resultingStatus === "Concluída" ? (current.completed_at ?? nowIso()) : current.completed_at ?? null,
        updated_at: nowIso(),
      };
      transaction.update(orderRef, updates);
      if (Object.keys(assetChanges).length > 1 || completing) transaction.update(assetRef, assetChanges);
      if (planSnap && planChanges) transaction.update(planSnap.ref, planChanges);
      order = { ...current, ...updates };
    });
    await writeAssetHistory(assetId, user.uid, "service_order.updated", `Ordem de serviço ${resultingStatus.toLowerCase()}.`, {
      id, status: resultingStatus, laborCost: order?.labor_cost, partsCost: order?.parts_cost,
      invoiceNumber: order?.invoice_number, odometerKm: order?.odometer_km,
      maintenanceDistanceKm: order?.maintenance_distance_km,
    });
    await writeAudit(user.organizationId, user.uid, "service_order.updated", "service_order", id, { status: resultingStatus });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
