import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, getRecord, getSessionUser, handleApiError, listRecords, nowIso, organizationScopedAsset, readJson, requireAdmin, setRecord, writeAssetHistory, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const [assets, plans, users] = await Promise.all([
      listRecords("assets", { organization_id: user.organizationId }),
      listRecords("maintenance_plans"),
      listRecords("users", { organization_id: user.organizationId }),
    ]);
    const visibleAssets = new Map(assets.filter((asset) => {
      const sharedWithUids = Array.isArray(asset.shared_with_uids) ? asset.shared_with_uids.map(String) : [];
      return user.role === "admin" || asset.owner_uid === user.uid || sharedWithUids.includes(user.uid);
    }).map((asset) => [asset.id, asset]));
    const people = new Map(users.map((person) => [person.id, person]));
    const response = NextResponse.json({
      plans: plans.filter((plan) => visibleAssets.has(String(plan.asset_id)))
        .sort((a, b) => String(visibleAssets.get(String(a.asset_id))?.next_maintenance ?? "").localeCompare(String(visibleAssets.get(String(b.asset_id))?.next_maintenance ?? "")))
        .map((plan) => {
          const asset = visibleAssets.get(String(plan.asset_id))!;
          return {
            ...plan, assetName: asset.name, ownerUid: asset.owner_uid,
            ownerName: people.get(String(asset.owner_uid))?.display_name ?? "",
            nextMaintenance: asset.next_maintenance,
          };
        }),
    });
    response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=180");
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(request);
    requireAdmin(user);
    const body = await readJson(request);
    const assetId = typeof body.assetId === "string" ? body.assetId : "";
    const intervalDays = body.intervalDays === null || body.intervalDays === "" ? null : Number(body.intervalDays);
    const intervalKm = body.intervalKm === null || body.intervalKm === "" ? null : Number(body.intervalKm);
    const intervalHours = body.intervalHours === null || body.intervalHours === "" ? null : Number(body.intervalHours);
    const advanceDays = body.advanceDays === undefined ? 7 : Number(body.advanceDays);
    const nextDueKm = body.nextDueKm === null || body.nextDueKm === "" ? null : Number(body.nextDueKm);
    const nextDueHours = body.nextDueHours === null || body.nextDueHours === "" ? null : Number(body.nextDueHours);
    const nextDate = typeof body.nextMaintenance === "string" ? body.nextMaintenance.trim() : "";
    await organizationScopedAsset(user, assetId);
    for (const [label, value, max] of [
      ["dias", intervalDays, 3650], ["quilômetros", intervalKm, 10_000_000],
      ["horas", intervalHours, 1_000_000], ["antecedência", advanceDays, 365],
      ["quilômetros previstos", nextDueKm, 10_000_000], ["horas previstas", nextDueHours, 1_000_000],
    ] as const) {
      if (value !== null && (!Number.isInteger(value) || value < (label === "antecedência" ? 0 : 1) || value > max)) {
        throw new ApiError(400, `Informe um valor válido para ${label}.`);
      }
    }
    if (intervalDays === null && intervalKm === null && intervalHours === null && !nextDate && nextDueKm === null && nextDueHours === null) {
      throw new ApiError(400, "Defina uma data ou meta de quilometragem/horas para a preventiva.");
    }
    if (nextDate && (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || Number.isNaN(Date.parse(`${nextDate}T00:00:00Z`)))) {
      throw new ApiError(400, "Informe uma data válida para a preventiva.");
    }
    const prior = (await listRecords("maintenance_plans", { asset_id: assetId }))[0];
    const id = prior?.id ?? randomUUID();
    const timestamp = nowIso();
    await setRecord("maintenance_plans", id, {
      asset_id: assetId, interval_days: intervalDays, interval_km: intervalKm,
      interval_hours: intervalHours, advance_days: advanceDays, next_due_km: nextDueKm,
      next_due_hours: nextDueHours, updated_at: timestamp, created_at: prior?.created_at ?? timestamp,
    });
    const asset = await getRecord("assets", assetId);
    if (!asset) throw new ApiError(404, "Ativo não encontrado.");
    await setRecord("assets", assetId, { next_maintenance: nextDate, updated_at: timestamp });
    await writeAssetHistory(assetId, user.uid, "maintenance_plan.updated", "Plano de manutenção atualizado.", { intervalDays, intervalKm, intervalHours, nextDate });
    await writeAudit(user.organizationId, user.uid, "maintenance_plan.updated", "asset", assetId);
    return NextResponse.json({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
