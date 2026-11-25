import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, getRecord, getSessionUser, handleApiError, listRecords, listRecordsMatchingAny, nowIso, organizationScopedAsset, readJson, setRecord, writeAssetHistory, writeAudit } from "@/lib/api";

export const runtime = "nodejs";
const priorities = new Set(["Baixa", "Normal", "Alta", "Urgente"]);
const kinds = new Set(["Preventiva", "Corretiva", "Inspeção"]);

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const assets = await listRecords("assets", { organization_id: user.organizationId });
    const visible = new Map(assets.filter((asset) => user.role === "admin" || asset.owner_uid === user.uid).map((asset) => [asset.id, asset]));
    const orders = await listRecordsMatchingAny("service_orders", "asset_id", [...visible.keys()]);
    const users = await listRecordsMatchingAny("users", "__name__", [...new Set(orders.flatMap((order) => [
      String(order.opened_by ?? ""),
      String(order.assigned_to ?? ""),
    ]).filter(Boolean))]);
    const people = new Map(users.map((person) => [person.id, person]));
    const result = orders.filter((order) => visible.has(String(order.asset_id)))
      .sort((a, b) => {
        const statusRank = (value: unknown) => value === "Aberta" ? 0 : value === "Em andamento" ? 1 : 2;
        const priorityRank = (value: unknown) => value === "Urgente" ? 0 : value === "Alta" ? 1 : 2;
        return statusRank(a.status) - statusRank(b.status) || priorityRank(a.priority) - priorityRank(b.priority) ||
          String(b.created_at).localeCompare(String(a.created_at));
      }).map((order) => ({
        ...order, assetName: visible.get(String(order.asset_id))?.name,
        assetTag: visible.get(String(order.asset_id))?.tag,
        openedByName: people.get(String(order.opened_by))?.display_name ?? "",
        assignedToName: people.get(String(order.assigned_to))?.display_name ?? null,
      }));
    return NextResponse.json({ orders: result });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(request);
    const body = await readJson(request);
    const assetId = typeof body.assetId === "string" ? body.assetId : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const kind = typeof body.kind === "string" ? body.kind : "Corretiva";
    const priority = typeof body.priority === "string" ? body.priority : "Normal";
    const dueDate = typeof body.dueDate === "string" ? body.dueDate : "";
    if (!description || description.length > 2000) throw new ApiError(400, "Descreva o serviço (até 2.000 caracteres).");
    if (!kinds.has(kind) || !priorities.has(priority)) throw new ApiError(400, "Tipo ou prioridade inválida.");
    if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`)))) throw new ApiError(400, "Prazo inválido.");
    await organizationScopedAsset(user, assetId);
    let assignedTo: string | null = null;
    if (user.role === "admin" && typeof body.assignedTo === "string" && body.assignedTo.trim()) {
      const assignee = await getRecord("users", body.assignedTo.trim());
      if (!assignee || assignee.organization_id !== user.organizationId || !assignee.active) throw new ApiError(400, "Selecione um responsável válido para a ordem.");
      assignedTo = assignee.id;
    }
    const id = randomUUID();
    const timestamp = nowIso();
    await setRecord("service_orders", id, {
      asset_id: assetId, opened_by: user.uid, assigned_to: assignedTo,
      kind, description, priority, status: "Aberta", due_date: dueDate, odometer_km: null,
      hours_used: null, labor_cost: 0, parts_cost: 0, completed_at: null,
      maintenance_distance_km: null, created_at: timestamp, updated_at: timestamp,
    });
    await writeAssetHistory(assetId, user.uid, "service_order.created", `Ordem de serviço aberta: ${description}`, { id, kind, priority });
    await writeAudit(user.organizationId, user.uid, "service_order.created", "service_order", id);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
