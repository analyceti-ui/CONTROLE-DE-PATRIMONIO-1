import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, getDatabase, getRecord, getSessionUser, handleApiError, readJson, requireOrganizationUser, writeAudit } from "@/lib/api";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser(request);
    const { id } = await context.params;
    const body = await readJson(request);
    const item = await getRecord("inventory_items", id);
    if (!item) throw new ApiError(404, "Item de estoque não encontrado.");
    requireOrganizationUser(user, String(item.organization_id));
    const delta = Number(body.quantityDelta);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!Number.isFinite(delta) || delta === 0 || !reason || reason.length > 160) throw new ApiError(400, "Informe uma alteração de quantidade e o motivo.");
    const db = getDatabase();
    let updatedQuantity = 0;
    await db.runTransaction(async (transaction) => {
      const ref = db.collection("inventory_items").doc(id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data()?.organization_id !== user.organizationId) throw new ApiError(404, "Item de estoque não encontrado.");
      const current = Number(snapshot.data()?.quantity ?? 0);
      updatedQuantity = current + delta;
      if (updatedQuantity < 0) throw new ApiError(409, "O saldo do estoque não pode ficar negativo.");
      transaction.update(ref, { quantity: updatedQuantity, updated_at: new Date().toISOString() });
      transaction.create(db.collection("inventory_transactions").doc(randomUUID()), {
        item_id: id, actor_uid: user.uid, quantity_delta: delta, reason, created_at: new Date().toISOString(),
      });
    });
    await writeAudit(user.organizationId, user.uid, "inventory.adjusted", "inventory_item", id, { delta, reason });
    return NextResponse.json({ ok: true, quantity: updatedQuantity });
  } catch (error) {
    return handleApiError(error);
  }
}
