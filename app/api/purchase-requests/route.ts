import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, getSessionUser, handleApiError, listRecords, nowIso, readJson, setRecord, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const [requests, users] = await Promise.all([
      listRecords("purchase_requests", { organization_id: user.organizationId }),
      listRecords("users", { organization_id: user.organizationId }),
    ]);
    const people = new Map(users.map((person) => [person.id, person]));
    const filtered = requests.filter((item) => user.role === "admin" || item.requester_uid === user.uid)
      .sort((a, b) => {
        const status = (a.status === "Pendente" ? 0 : 1) - (b.status === "Pendente" ? 0 : 1);
        return status || String(b.created_at).localeCompare(String(a.created_at));
      }).map((item) => ({
        ...item, requesterName: people.get(String(item.requester_uid))?.display_name ?? "",
        requesterEmail: people.get(String(item.requester_uid))?.email ?? "",
      }));
    return NextResponse.json({ requests: filtered });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(request);
    const body = await readJson(request);
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const quantity = Number(body.quantity ?? 1);
    const estimatedCost = Number(body.estimatedCost ?? 0);
    if (!description || description.length > 500) throw new ApiError(400, "Descreva o material ou serviço (até 500 caracteres).");
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(estimatedCost) || estimatedCost < 0) throw new ApiError(400, "Informe quantidade e custo válidos.");
    const id = randomUUID();
    const timestamp = nowIso();
    await setRecord("purchase_requests", id, {
      organization_id: user.organizationId, requester_uid: user.uid, description, quantity, estimated_cost: estimatedCost,
      status: "Pendente", created_at: timestamp, updated_at: timestamp,
    });
    await writeAudit(user.organizationId, user.uid, "purchase_request.created", "purchase_request", id);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
