import { NextResponse } from "next/server";
import { ApiError, getFirestoreDb, getSessionUser, handleApiError, listRecords, listRecordsMatchingAny, nowIso, readJson, writeAudit } from "@/lib/api";

export const runtime = "nodejs";
const excludedStatuses = new Set(["Baixado", "Descartado", "Descartados"]);
const dayMs = 86_400_000;
const notificationCache = new Map<string, { savedAt: number; data: { alerts: Record<string, unknown>[]; preferences: { inApp: number; emailEnabled: number }; externalDeliveryConfigured: boolean } }>();
const notificationCacheTtlMs = 60_000;

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const cached = notificationCache.get(user.uid);
    if (cached && Date.now() - cached.savedAt < notificationCacheTtlMs) {
      const response = NextResponse.json(cached.data);
      response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
      return response;
    }
    const [assets, preference] = await Promise.all([
      listRecords("assets", { organization_id: user.organizationId }),
      getFirestoreDb().collection("notification_preferences").doc(user.uid).get(),
    ]);
    const visible = assets.filter((asset) => {
      const sharedWithUids = Array.isArray(asset.shared_with_uids) ? asset.shared_with_uids.map(String) : [];
      return (user.role === "admin" || asset.owner_uid === user.uid || sharedWithUids.includes(user.uid)) && !excludedStatuses.has(String(asset.status));
    });
    const [plans, users] = await Promise.all([
      listRecordsMatchingAny("maintenance_plans", "asset_id", visible.map((asset) => asset.id)),
      listRecordsMatchingAny("users", "__name__", [...new Set(visible.map((asset) => String(asset.owner_uid ?? "")).filter(Boolean))]),
    ]);
    const plansByAsset = new Map(plans.map((plan) => [String(plan.asset_id), plan]));
    const people = new Map(users.map((person) => [person.id, person]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const alerts: Record<string, unknown>[] = [];
    for (const asset of visible) {
      const ownerName = people.get(String(asset.owner_uid))?.display_name ?? "";
      const plan = plansByAsset.get(String(asset.id));
      const nextDate = String(asset.next_maintenance ?? "");
      if (nextDate) {
        const dueDate = new Date(`${nextDate}T00:00:00`);
        if (!Number.isNaN(dueDate.getTime())) {
          const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / dayMs);
          if (daysUntil <= Number(plan?.advance_days ?? 30)) {
            alerts.push({
              assetId: asset.id, assetName: asset.name, dueDate: nextDate, ownerName, daysUntil,
              kind: "maintenance",
              message: daysUntil < 0 ? `Preventiva vencida há ${Math.abs(daysUntil)} dia(s)`
                : daysUntil === 0 ? "Preventiva prevista para hoje" : `Preventiva prevista em ${daysUntil} dia(s)`,
            });
          }
        }
      }
      if (plan?.next_due_km != null && asset.vehicle_km != null) {
        const remaining = Number(plan.next_due_km) - Number(asset.vehicle_km);
        if (remaining <= 500) alerts.push({
          assetId: asset.id, assetName: asset.name, ownerName, currentValue: asset.vehicle_km, dueValue: plan.next_due_km,
          kind: "maintenance_km",
          message: remaining < 0 ? `Preventiva vencida por ${Math.abs(remaining).toLocaleString("pt-BR")} km`
            : remaining === 0 ? "Preventiva atingiu a quilometragem prevista" : `Preventiva próxima: faltam ${remaining.toLocaleString("pt-BR")} km`,
        });
      }
      if (plan?.next_due_hours != null && asset.usage_hours != null) {
        const remaining = Number(plan.next_due_hours) - Number(asset.usage_hours);
        if (remaining <= 20) alerts.push({
          assetId: asset.id, assetName: asset.name, ownerName, currentValue: asset.usage_hours, dueValue: plan.next_due_hours,
          kind: "maintenance_hours",
          message: remaining < 0 ? `Preventiva vencida por ${Math.abs(remaining).toLocaleString("pt-BR")} h`
            : remaining === 0 ? "Preventiva atingiu as horas previstas" : `Preventiva próxima: faltam ${remaining.toLocaleString("pt-BR")} h`,
        });
      }
      const warrantyUntil = String(asset.warranty_until ?? "");
      if (warrantyUntil) {
        const days = (new Date(`${warrantyUntil}T00:00:00`).getTime() - today.getTime()) / dayMs;
        if (days <= 30) alerts.push({
          assetId: asset.id, assetName: asset.name, dueDate: warrantyUntil, ownerName, kind: "warranty",
          message: `Garantia até ${new Intl.DateTimeFormat("pt-BR").format(new Date(`${warrantyUntil}T00:00:00`))}`,
        });
      }
    }
    const preferences = preference.exists ? preference.data() : undefined;
    const data = {
      alerts,
      preferences: preferences ? { inApp: preferences.in_app ? 1 : 0, emailEnabled: preferences.email_enabled ? 1 : 0 } : { inApp: 1, emailEnabled: 0 },
      externalDeliveryConfigured: Boolean(process.env.EMAIL_PROVIDER_API_KEY),
    };
    notificationCache.set(user.uid, { savedAt: Date.now(), data });
    const response = NextResponse.json(data);
    response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getSessionUser(request);
    const body = await readJson(request);
    if (typeof body.inApp !== "boolean" || typeof body.emailEnabled !== "boolean") throw new ApiError(400, "Informe as preferências de aviso.");
    if (body.emailEnabled && !process.env.EMAIL_PROVIDER_API_KEY) throw new ApiError(400, "Avisos por e-mail ainda não têm um serviço configurado; use os avisos no painel.");
    await getFirestoreDb().collection("notification_preferences").doc(user.uid).set({
      user_uid: user.uid, in_app: body.inApp, email_enabled: body.emailEnabled, updated_at: nowIso(),
    }, { merge: true });
    notificationCache.delete(user.uid);
    await writeAudit(user.organizationId, user.uid, "notifications.updated", "user", user.uid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
