import { NextResponse } from "next/server";
import {
  ApiError,
  createSession,
  createUserRecord,
  deleteSession,
  getFirebaseAuth,
  getFirestoreDb,
  getRecord,
  handleApiError,
  nowIso,
  readJson,
  sessionCookie,
} from "@/lib/api";

export const runtime = "nodejs";

type AccountRecord = Record<string, unknown> & { id: string };

async function provisionBootstrapAdmin(uid: string, email: string, password?: string) {
  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (email !== bootstrapEmail || !bootstrapPassword || bootstrapPassword.length < 8 ||
    (password !== undefined && password !== bootstrapPassword)) {
    throw new ApiError(403, "Este usuário ainda não foi provisionado. Confira os dados de acesso do administrador.");
  }

  const db = getFirestoreDb();
  const organizationId = process.env.BOOTSTRAP_ORGANIZATION_ID || "default-organization";
  const timestamp = nowIso();
  const existing = await db.collection("users").where("email", "==", email).limit(1).get();
  if (!existing.empty) {
    const account = existing.docs[0];
    await account.ref.set({
      auth_uid: uid,
      role: "admin",
      active: true,
      must_change_password: false,
      updated_at: timestamp,
    }, { merge: true });
    const data = account.data();
    const organization = typeof data.organization_id === "string" ? data.organization_id : organizationId;
    await db.collection("organizations").doc(organization).set({
      name: process.env.BOOTSTRAP_ORGANIZATION_NAME || "Minha organização",
      created_at: timestamp,
    }, { merge: true });
    return { id: account.id, ...data, auth_uid: uid, role: "admin", active: true } as AccountRecord;
  }

  await db.collection("organizations").doc(organizationId).set({
    name: process.env.BOOTSTRAP_ORGANIZATION_NAME || "Minha organização",
    created_at: timestamp,
  }, { merge: true });

  const profile = {
    email,
    auth_uid: uid,
    display_name: "Administrador",
    role: "admin",
    organization_id: organizationId,
    active: true,
    must_change_password: false,
    email_notifications: false,
    created_at: timestamp,
  };
  await createUserRecord(uid, email, profile);
  return { id: uid, ...profile } as AccountRecord;
}

async function getAccountForFirebaseUser(uid: string, email: string, password?: string): Promise<AccountRecord> {
  const direct = await getRecord("users", uid);
  if (direct) return direct;

  const db = getFirestoreDb();
  const matches = await db.collection("users").where("email", "==", email).limit(1).get();
  if (!matches.empty) {
    const doc = matches.docs[0];
    await doc.ref.set({ auth_uid: uid, updated_at: nowIso() }, { merge: true });
    return { id: doc.id, ...doc.data(), auth_uid: uid } as AccountRecord;
  }

  return provisionBootstrapAdmin(uid, email, password);
}

async function issueSession(uid: string, email: string, password?: string) {
  const account = await getAccountForFirebaseUser(uid, email, password);
  if (!account.active) throw new ApiError(403, "Esta conta está desativada. Solicite ajuda ao administrador.");

  const token = await createSession(account.id);
  const response = NextResponse.json({
    uid: account.id,
    email: account.email,
    displayName: account.display_name,
    role: account.role,
    mustChangePassword: Boolean(account.must_change_password),
  });
  response.headers.set("Set-Cookie", sessionCookie(token, 60 * 60 * 24 * 14));
  return response;
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const auth = await getFirebaseAuth();

    if (body.action === "bootstrap") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        password.length < 8 || password.length > 128) {
        throw new ApiError(400, "Informe o e-mail e a senha inicial válidos.");
      }
      const expectedEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
      const expectedPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
      if (email !== expectedEmail || !expectedPassword || password !== expectedPassword) {
        throw new ApiError(403, "Os dados não correspondem ao administrador inicial configurado.");
      }

      let firebaseUser;
      try {
        firebaseUser = await auth.createUser({ email, password, displayName: "Administrador" });
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error &&
          error.code === "auth/email-already-exists") {
          throw new ApiError(409, "Esta conta já existe no Firebase Authentication. Entre com ela ou peça ao administrador para vinculá-la.");
        }
        throw error;
      }
      let account: AccountRecord;
      try {
        account = await provisionBootstrapAdmin(firebaseUser.uid, email, password);
      } catch (error) {
        await auth.deleteUser(firebaseUser.uid);
        throw error;
      }
      const token = await createSession(account.id);
      const response = NextResponse.json({
        uid: account.id,
        email: account.email,
        displayName: account.display_name,
        role: account.role,
        mustChangePassword: false,
      });
      response.headers.set("Set-Cookie", sessionCookie(token, 60 * 60 * 24 * 14));
      return response;
    }

    if (body.action !== "login" || typeof body.idToken !== "string" || !body.idToken) {
      throw new ApiError(400, "Faça login com Firebase Authentication.");
    }
    const decoded = await auth.verifyIdToken(body.idToken);
    const email = decoded.email?.trim().toLowerCase();
    if (!email) throw new ApiError(401, "A conta Firebase não possui um e-mail válido.");
    return await issueSession(decoded.uid, email);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error &&
      typeof error.code === "string" && error.code.startsWith("auth/")) {
      return NextResponse.json({ error: "Não foi possível validar sua conta do Firebase. Verifique o provedor de e-mail/senha e tente novamente." }, { status: 401 });
    }
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
