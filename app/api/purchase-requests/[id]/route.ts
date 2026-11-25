import { NextResponse } from "next/server";
import { ApiError, getDatabase, getRecord, getSessionUser, handleApiError, nowIso, readJson, requireAdmin, requireOrganizationUser, writeAudit } from "@/lib/api";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser(request);
    requireAdmin(user);
    const { id } = await context.params;
    const body = await readJson(request);
    const status = String(body.status ?? "");
    if (!["Aprovada", "Recusada", "Pendente"].includes(status)) throw new ApiError(400, "Selecione uma situação válida.");
    const item = await getRecord("purchase_requests", id);
    if (!item) throw new ApiError(404, "Solicitação não encontrada.");
    requireOrganizationUser(user, String(item.organization_id));
    await getDatabase().collection("purchase_requests").doc(id).update({ status, updated_at: nowIso() });
    await writeAudit(user.organizationId, user.uid, "purchase_request.updated", "purchase_request", id, { status });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
