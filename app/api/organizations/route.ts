import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, getFirebaseAuth, getFirestoreDb, getSessionUser, handleApiError, listRecords, readJson, requireAdmin, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    requireAdmin(user);
    const [organization, units] = await Promise.all([
      getFirestoreDb().collection("organizations").doc(user.organizationId).get(),
      listRecords("units", { organization_id: user.organizationId }),
    ]);
    return NextResponse.json({
      organization: organization.exists ? { id: organization.id, name: organization.data()?.name, createdAt: organization.data()?.created_at } : null,
      units: units.sort((a, b) => String(a.name).localeCompare(String(b.name))).map(({ id, name }) => ({ id, name })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const requester = await getSessionUser(request);
    requireAdmin(requester);
    const body = await readJson(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const adminName = typeof body.adminName === "string" ? body.adminName.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!name || name.length > 120 || !adminName || adminName.length > 100) throw new ApiError(400, "Informe nomes válidos para a organização e seu administrador.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ApiError(400, "Informe um e-mail válido para o administrador.");
    if (password.length < 8 || password.length > 128) throw new ApiError(400, "A senha inicial deve ter entre 8 e 128 caracteres.");
    const db = getFirestoreDb();
    const id = randomUUID();
    const firebaseAuth = getFirebaseAuth();
    const firebaseUser = await firebaseAuth.createUser({ email, password, displayName: adminName });
    const adminId = firebaseUser.uid;
    const timestamp = new Date().toISOString();
    const emailId = createHash("sha256").update(email).digest("hex");
    try {
      await db.runTransaction(async (transaction) => {
        const emailRef = db.collection("user_emails").doc(emailId);
        const existing = await transaction.get(emailRef);
        if (existing.exists) throw new ApiError(409, "Já existe uma conta com este e-mail.");
        transaction.create(emailRef, { email, uid: adminId, created_at: timestamp });
        transaction.create(db.collection("organizations").doc(id), { name, created_at: timestamp });
        transaction.create(db.collection("users").doc(adminId), {
          email, auth_uid: adminId, display_name: adminName, role: "admin",
          organization_id: id, active: true, must_change_password: true, email_notifications: false,
          created_at: timestamp,
        });
      });
    } catch (error) {
      await firebaseAuth.deleteUser(firebaseUser.uid);
      throw error;
    }
    await writeAudit(requester.organizationId, requester.uid, "organization.created", "organization", id, { name, adminEmail: email });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
