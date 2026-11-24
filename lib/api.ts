import { createHash, randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { NextResponse } from "next/server";
import {
  deleteRecord,
  deleteRecords,
  getRecord,
  getFirestoreDb,
  listRecords,
  nowIso,
  setRecord,
  type RecordData,
} from "@/lib/firestore";
import { ApiError } from "@/lib/errors";

export { ApiError } from "@/lib/errors";

export type UserRole = "admin" | "user";
export type SessionUser = {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  organizationId: string;
  mustChangePassword: boolean;
};
export type User = SessionUser & { createdAt: string };

export async function getFirebaseAuth() {
  const { getAuth } = await import("firebase-admin/auth");
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (privateKey?.startsWith('"') && privateKey.endsWith('"')) {
    try {
      const parsed = JSON.parse(privateKey);
      if (typeof parsed === "string") privateKey = parsed;
    } catch {}
  }
  privateKey = privateKey?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new ApiError(503, "Firebase não está configurado nas variáveis de ambiente.");
  }
  const app = getApps()[0] ?? initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
  return getAuth(app);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [algorithm, saltHex, keyHex] = storedHash.split(":");
  if (algorithm !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createId() {
  return randomUUID();
}

export async function createUserRecord(uid: string, email: string, data: Record<string, unknown>) {
  const db = getFirestoreDb();
  const normalizedEmail = email.trim().toLowerCase();
  const emailId = createHash("sha256").update(normalizedEmail).digest("hex");
  await db.runTransaction(async (transaction) => {
    const emailRef = db.collection("user_emails").doc(emailId);
    const reservation = await transaction.get(emailRef);
    if (reservation.exists) throw new ApiError(409, "Já existe uma conta com este e-mail.");
    transaction.create(emailRef, { email: normalizedEmail, uid, created_at: nowIso() });
    transaction.create(db.collection("users").doc(uid), { ...data, email: normalizedEmail });
  });
}

export function createSession(userUid: string) {
  return createSessionAsync(userUid);
}

async function createSessionAsync(userUid: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  await setRecord("sessions", tokenHash, { user_uid: userUid, expires_at: expiresAt, created_at: nowIso() });
  return token;
}

export function getSessionToken(request: Request) {
  const cookie = request.headers.get("cookie");
  const token = cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("patrimonio_session="))
    ?.slice("patrimonio_session=".length);
  return token ? decodeURIComponent(token) : "";
}

export async function getSessionUser(request: Request, allowPasswordChange = false): Promise<SessionUser> {
  const token = getSessionToken(request);
  if (!token) throw new ApiError(401, "Faça login para continuar.");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await getRecord("sessions", tokenHash);
  if (!session || String(session.expires_at) <= nowIso()) {
    if (session) await deleteRecord("sessions", tokenHash);
    throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
  }
  const account = await getRecord("users", String(session.user_uid));
  if (!account || !account.active) throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
  if (account.must_change_password && !allowPasswordChange) {
    throw new ApiError(403, "Altere sua senha inicial para continuar.");
  }
  return {
    uid: account.id,
    email: String(account.email),
    displayName: String(account.display_name),
    role: account.role as UserRole,
    organizationId: String(account.organization_id),
    mustChangePassword: Boolean(account.must_change_password),
  };
}

export async function deleteSession(request: Request) {
  const token = getSessionToken(request);
  if (token) await deleteRecord("sessions", createHash("sha256").update(token).digest("hex"));
}

export function requireAdmin(user: SessionUser) {
  if (user.role !== "admin") throw new ApiError(403, "Acesso permitido somente para administradores.");
}

export async function writeAudit(
  organizationId: string,
  actorUid: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
) {
  const id = createId();
  await setRecord("audit_log", id, {
    organization_id: organizationId,
    actor_uid: actorUid,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details_json: JSON.stringify(details),
    created_at: nowIso(),
  });
}

export async function writeAssetHistory(
  assetId: string,
  actorUid: string | null,
  eventType: string,
  description: string,
  metadata: Record<string, unknown> = {},
) {
  const id = createId();
  await setRecord("asset_history", id, {
    asset_id: assetId,
    actor_uid: actorUid,
    event_type: eventType,
    description,
    metadata_json: JSON.stringify(metadata),
    created_at: nowIso(),
  });
}

export async function organizationScopedAsset(user: SessionUser, assetId: string) {
  const asset = await getRecord("assets", assetId);
  if (!asset || asset.organization_id !== user.organizationId ||
    (user.role !== "admin" && asset.owner_uid !== user.uid)) {
    throw new ApiError(404, "Ativo não encontrado.");
  }
  return asset;
}

export function requireOrganizationUser(user: SessionUser, organizationId: string) {
  if (user.organizationId !== organizationId) throw new ApiError(404, "Registro não encontrado.");
}

export async function recordFailedLogin(email: string, ipAddress: string) {
  const db = getFirestoreDb();
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const [emailAttempts, ipAttempts] = await Promise.all([
    db.collection("login_attempts").where("email", "==", email).get(),
    db.collection("login_attempts").where("ip_address", "==", ipAddress).get(),
  ]);
  const attempts = new Map([...emailAttempts.docs, ...ipAttempts.docs].map((doc) => [doc.id, doc.data()]));
  const recentAttempts = [...attempts.values()].filter((item) => String(item.attempted_at) > cutoff).length;
  if (recentAttempts >= 10) {
    throw new ApiError(429, "Muitas tentativas de login. Aguarde 15 minutos e tente novamente.");
  }
  await setRecord("login_attempts", createId(), { email, ip_address: ipAddress, attempted_at: nowIso() });
}

export async function clearLoginAttempts(email: string, ipAddress: string) {
  await Promise.all([
    deleteRecords("login_attempts", "email", email),
    deleteRecords("login_attempts", "ip_address", ipAddress),
  ]);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ApiError(400, "Envie um corpo JSON válido.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "O corpo da solicitação deve ser um objeto JSON.");
  }
  return value as Record<string, unknown>;
}

export function handleApiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Erro inesperado na API:", error);
  return NextResponse.json({ error: "Não foi possível concluir a operação." }, { status: 500 });
}

export function sessionCookie(token: string, maxAge: number) {
  return `patrimonio_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export async function getOrganizationRecords<T extends RecordData = RecordData>(
  collection: string,
  organizationId: string,
) {
  return listRecords<T>(collection, { organization_id: organizationId });
}

export { deleteRecord, deleteRecords, getRecord, getFirestoreDb, listRecords, nowIso, setRecord };
