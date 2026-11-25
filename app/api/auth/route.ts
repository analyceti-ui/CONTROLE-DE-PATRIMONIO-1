import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createId, createSession, createUserRecord, deleteSession, getDatabase, handleApiError, readJson, recordFailedLogin, clearLoginAttempts, sessionCookie, verifyPassword, hashPassword, nowIso } from "@/lib/api";

export const runtime = "nodejs";

async function findUser(email: string): Promise<(Record<string, unknown> & { id: string }) | undefined> {
  const db = getDatabase();
  const matches = await db.collection("users").where("email", "==", email).limit(1).get();
  if (!matches.empty) return { id: matches.docs[0].id, ...matches.docs[0].data() } as Record<string, unknown> & { id: string };

  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (email !== bootstrapEmail || !bootstrapPassword || bootstrapPassword.length < 8) return undefined;
  const organizationId = process.env.BOOTSTRAP_ORGANIZATION_ID || "default-organization";
  const emailId = createHash("sha256").update(email).digest("hex");
  const existingReservation = await db.collection("user_emails").doc(emailId).get();
  const userId = existingReservation.exists ? String(existingReservation.data()?.uid || createId()) : createId();
  const timestamp = nowIso();
  const passwordHash = hashPassword(bootstrapPassword);
  await db.collection("organizations").doc(organizationId).set({
    name: process.env.BOOTSTRAP_ORGANIZATION_NAME || "Minha organização",
    created_at: timestamp,
  }, { merge: true });
  const account = {
    email,
    display_name: "Administrador",
    password_hash: passwordHash,
    role: "admin",
    organization_id: organizationId,
    active: true,
    must_change_password: false,
    email_notifications: false,
    created_at: timestamp,
  };
  try {
    if (existingReservation.exists) {
      await db.collection("users").doc(userId).set(account, { merge: true });
      await db.collection("user_emails").doc(emailId).set({ email, uid: userId, created_at: timestamp }, { merge: true });
    } else {
      await createUserRecord(userId, email, account);
    }
  } catch (error) {
    const existing = await db.collection("users").where("email", "==", email).limit(1).get();
    if (!existing.empty) return { id: existing.docs[0].id, ...existing.docs[0].data() } as Record<string, unknown> & { id: string };
    throw error;
  }
  return { id: userId, ...account };
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") || "unknown";
    if (body.action !== "login") {
      return NextResponse.json({ error: "Cadastro público desativado. Solicite acesso ao administrador." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password || password.length > 128) {
      return NextResponse.json({ error: "Informe um e-mail e uma senha válidos." }, { status: 400 });
    }
    const user = await findUser(email);
    if (!user || !user.active || !verifyPassword(password, String(user.password_hash))) {
      await recordFailedLogin(email, ipAddress);
      return NextResponse.json({ error: "E-mail ou senha incorretos." }, { status: 401 });
    }
    await clearLoginAttempts(email, ipAddress);
    const token = await createSession(user.id);
    const response = NextResponse.json({
      uid: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      mustChangePassword: Boolean(user.must_change_password),
    });
    response.headers.set("Set-Cookie", sessionCookie(token, 60 * 60 * 24 * 14));
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await deleteSession(request);
    const response = NextResponse.json({ ok: true });
    response.headers.set("Set-Cookie", sessionCookie("", 0));
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
