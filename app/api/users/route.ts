import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, createId, createUserRecord, getDatabase, getRecord, getSessionToken, getSessionUser, handleApiError, hashPassword, readJson, requireAdmin, verifyPassword, writeAudit } from "@/lib/api";
import { defaultUserPermissions, isUserPermissions } from "@/lib/permissions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const requester = await getSessionUser(request);
    requireAdmin(requester);
    const body = await readJson(request);
    const displayName = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = "user";
    if (!displayName || displayName.length > 100) throw new ApiError(400, "Informe o nome do usuário (até 100 caracteres).");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ApiError(400, "Informe um e-mail válido.");
    if (password.length < 8 || password.length > 128) throw new ApiError(400, "A senha inicial deve ter entre 8 e 128 caracteres.");
    const uid = createId();
    await createUserRecord(uid, email, {
      email, display_name: displayName, password_hash: hashPassword(password), role,
      organization_id: requester.organizationId, active: true, must_change_password: true,
      email_notifications: false, permissions: defaultUserPermissions, created_at: new Date().toISOString(),
    });
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
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 8 || newPassword.length > 128) throw new ApiError(400, "A nova senha deve ter entre 8 e 128 caracteres.");
    const account = await getRecord("users", user.uid);
    if (!account || !verifyPassword(currentPassword, String(account.password_hash))) {
      throw new ApiError(400, "A senha atual está incorreta.");
    }
    const db = getDatabase();
    await db.collection("users").doc(user.uid).update({
      password_hash: hashPassword(newPassword), must_change_password: false, updated_at: new Date().toISOString(),
    });
    const sessionToken = getSessionToken(request);
    const currentSessionId = createHash("sha256").update(sessionToken).digest("hex");
    const sessions = await db.collection("sessions").where("user_uid", "==", user.uid).get();
    await Promise.all(sessions.docs
      .filter((session) => session.id !== currentSessionId)
      .map((session) => session.ref.delete()));
    await writeAudit(user.organizationId, user.uid, "user.password_changed", "user", user.uid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const requester = await getSessionUser(request);
    requireAdmin(requester);
    const snapshot = await getDatabase().collection("users")
      .where("organization_id", "==", requester.organizationId).get();
    const users = snapshot.docs.map((doc) => {
      const user = doc.data();
      return {
        uid: doc.id, email: user.email, displayName: user.display_name, role: user.role,
        createdAt: user.created_at, active: user.active ? 1 : 0,
        mustChangePassword: user.must_change_password ? 1 : 0,
        permissions: isUserPermissions(user.permissions) ? user.permissions : null,
      };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return NextResponse.json({ users });
  } catch (error) {
    return handleApiError(error);
  }
}
