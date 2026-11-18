import { NextResponse } from "next/server";
import { ApiError, deleteRecords, getFirebaseAuth, getFirestoreDb, getRecord, getSessionUser, handleApiError, readJson, requireAdmin, writeAudit } from "@/lib/api";

type RouteContext = { params: Promise<{ uid: string }> };
export const runtime = "nodejs";

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const requester = await getSessionUser(request);
    requireAdmin(requester);
    const { uid } = await context.params;
    const body = await readJson(request);
    const db = getFirestoreDb();
    const target = await getRecord("users", uid);
    if (!target || target.organization_id !== requester.organizationId) throw new ApiError(404, "Usuário não encontrado.");
    if (typeof body.role === "string" && body.role !== "admin" && body.role !== "user") {
      throw new ApiError(400, "O perfil deve ser administrador ou usuário.");
    }
    if (body.active !== undefined && typeof body.active !== "boolean") {
      throw new ApiError(400, "O estado da conta deve ser ativo ou inativo.");
    }
    if (body.role === undefined && body.active === undefined && body.password === undefined) {
      throw new ApiError(400, "Informe um perfil, estado ou nova senha.");
    }
    if (uid === requester.uid && body.active === false) throw new ApiError(400, "Você não pode desativar sua própria conta.");
    if (body.password !== undefined && (typeof body.password !== "string" ||
      body.password.length < 8 || body.password.length > 128)) {
      throw new ApiError(400, "Informe uma nova senha válida.");
    }

    const firebaseAuth = getFirebaseAuth();
    let firebaseUid = typeof target.auth_uid === "string" ? target.auth_uid : "";
    if (!firebaseUid) {
      try {
        firebaseUid = (await firebaseAuth.getUserByEmail(String(target.email))).uid;
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "auth/user-not-found")) {
          throw error;
        }
      }
    }
    if (firebaseUid) {
      const authUpdates: { password?: string; disabled?: boolean } = {};
      if (typeof body.password === "string") authUpdates.password = body.password;
      if (typeof body.active === "boolean") authUpdates.disabled = !body.active;
      if (Object.keys(authUpdates).length) await firebaseAuth.updateUser(firebaseUid, authUpdates);
    } else if (typeof body.password === "string") {
      const created = await firebaseAuth.createUser({
        email: String(target.email),
        password: body.password,
        displayName: String(target.display_name || ""),
        disabled: body.active === false || target.active === false,
      });
      firebaseUid = created.uid;
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
      if (firebaseUid) updates.auth_uid = firebaseUid;
      if (typeof body.password === "string") {
        updates.must_change_password = true;
      }
      transaction.update(currentSnap.ref, updates);
    });
    if (body.active === false || body.password !== undefined) await deleteRecords("sessions", "user_uid", uid);
    await writeAudit(requester.organizationId, requester.uid, "user.updated", "user", uid, {
      role: body.role, active: body.active, passwordReset: body.password !== undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
