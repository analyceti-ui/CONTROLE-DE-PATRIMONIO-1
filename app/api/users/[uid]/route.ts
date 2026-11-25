import { NextResponse } from "next/server";
import { ApiError, deleteRecords, getDatabase, getRecord, getSessionUser, handleApiError, hashPassword, readJson, requireAdmin, writeAudit } from "@/lib/api";
import { hasValidPermissionDependencies, isUserPermissions } from "@/lib/permissions";

type RouteContext = { params: Promise<{ uid: string }> };
export const runtime = "nodejs";

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const requester = await getSessionUser(request);
    requireAdmin(requester);
    const { uid } = await context.params;
    const body = await readJson(request);
    const db = getDatabase();
    const target = await getRecord("users", uid);
    if (!target || target.organization_id !== requester.organizationId) throw new ApiError(404, "Usuário não encontrado.");
    if (typeof body.role === "string" && body.role !== "admin" && body.role !== "user") {
      throw new ApiError(400, "O perfil deve ser administrador ou usuário.");
    }
    if (body.active !== undefined && typeof body.active !== "boolean") {
      throw new ApiError(400, "O estado da conta deve ser ativo ou inativo.");
    }
    if (body.permissions !== undefined && !isUserPermissions(body.permissions)) {
      throw new ApiError(400, "As permissões informadas são inválidas.");
    }
    if (isUserPermissions(body.permissions) && !hasValidPermissionDependencies(body.permissions)) {
      throw new ApiError(400, "Para liberar preventivas, ordens, inspeções ou abastecimento, conceda ao menos visualização de Equipamentos.");
    }
    if (body.role === undefined && body.active === undefined && body.password === undefined && body.permissions === undefined) {
      throw new ApiError(400, "Informe um perfil, estado, senha ou permissões.");
    }
    if (uid === requester.uid && body.active === false) throw new ApiError(400, "Você não pode desativar sua própria conta.");
    if (body.password !== undefined && (typeof body.password !== "string" ||
      body.password.length < 8 || body.password.length > 128)) {
      throw new ApiError(400, "Informe uma nova senha válida.");
    }

    await db.runTransaction(async (transaction) => {
      const currentSnap = await transaction.get(db.collection("users").doc(uid));
      if (!currentSnap.exists || currentSnap.data()?.organization_id !== requester.organizationId) {
        throw new ApiError(404, "Usuário não encontrado.");
      }
      const current = currentSnap.data()!;
      const demoting = current.role === "admin" && (body.role === "user" || body.active === false);
      if (demoting && current.active) {
        const organizationUsers = await db.collection("users")
          .where("organization_id", "==", requester.organizationId).get();
        const admins = organizationUsers.docs.filter((doc) =>
          doc.data().role === "admin" && doc.data().active === true);
        if (admins.length <= 1) throw new ApiError(409, "Não é possível remover o último administrador.");
      }
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.role === "admin" || body.role === "user") updates.role = body.role;
      if (typeof body.active === "boolean") updates.active = body.active;
      if (isUserPermissions(body.permissions)) updates.permissions = body.permissions;
      if (typeof body.password === "string") {
        updates.password_hash = hashPassword(body.password);
        updates.must_change_password = true;
      }
      transaction.update(currentSnap.ref, updates);
    });
    if (body.active === false || body.password !== undefined) await deleteRecords("sessions", "user_uid", uid);
    await writeAudit(requester.organizationId, requester.uid, "user.updated", "user", uid, {
      role: body.role, active: body.active, passwordReset: body.password !== undefined,
      permissionsUpdated: body.permissions !== undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
