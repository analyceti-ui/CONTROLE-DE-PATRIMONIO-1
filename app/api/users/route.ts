import { NextResponse } from "next/server";
import { ApiError, createUserRecord, deleteRecords, getFirebaseAuth, getFirestoreDb, getRecord, getSessionUser, handleApiError, readJson, requireAdmin, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const requester = await getSessionUser(request);
    requireAdmin(requester);
    const body = await readJson(request);
    const displayName = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role === "admin" || body.role === "user" ? body.role : "";
    if (!displayName || displayName.length > 100) throw new ApiError(400, "Informe o nome do usuário (até 100 caracteres).");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ApiError(400, "Informe um e-mail válido.");
    if (password.length < 8 || password.length > 128) throw new ApiError(400, "A senha inicial deve ter entre 8 e 128 caracteres.");
    if (!role) throw new ApiError(400, "Selecione um perfil válido.");
    const firebaseAuth = getFirebaseAuth();
    const firebaseUser = await firebaseAuth.createUser({ email, password, displayName });
    try {
      await createUserRecord(firebaseUser.uid, email, {
        email, auth_uid: firebaseUser.uid, display_name: displayName, role,
        organization_id: requester.organizationId, active: true, must_change_password: true,
        email_notifications: false, created_at: new Date().toISOString(),
      });
    } catch (error) {
      await firebaseAuth.deleteUser(firebaseUser.uid);
      throw error;
    }
    await writeAudit(requester.organizationId, requester.uid, "user.created", "user", email, { email, role });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getSessionUser(request, true);
    const body = await readJson(request);
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 8 || newPassword.length > 128) throw new ApiError(400, "A nova senha deve ter entre 8 e 128 caracteres.");
    const account = await getRecord("users", user.uid);
    if (!account) throw new ApiError(404, "Usuário não encontrado.");
    const authUid = String(account.auth_uid || account.id);
    await getFirebaseAuth().updateUser(authUid, { password: newPassword });
    await getFirestoreDb().collection("users").doc(user.uid).update({
      must_change_password: false, updated_at: new Date().toISOString(),
    });
    await deleteRecords("sessions", "user_uid", user.uid);
    await writeAudit(user.organizationId, user.uid, "user.password_changed", "user", user.uid);
    const response = NextResponse.json({ ok: true });
    response.headers.set("Set-Cookie", "patrimonio_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const requester = await getSessionUser(request);
    requireAdmin(requester);
    const snapshot = await getFirestoreDb().collection("users")
      .where("organization_id", "==", requester.organizationId).get();
    const users = snapshot.docs.map((doc) => {
      const user = doc.data();
      return {
        uid: doc.id, email: user.email, displayName: user.display_name, role: user.role,
        createdAt: user.created_at, active: user.active ? 1 : 0,
        mustChangePassword: user.must_change_password ? 1 : 0,
      };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return NextResponse.json({ users });
  } catch (error) {
    return handleApiError(error);
  }
}
