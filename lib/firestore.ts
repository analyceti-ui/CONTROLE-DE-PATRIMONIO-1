import { cert, getApps, initializeApp } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { ApiError } from "@/lib/errors";

let firestore: Firestore | undefined;
let firebaseAuth: Auth | undefined;

function getAdminApp() {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (privateKey?.startsWith('"') && privateKey.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(privateKey);
      if (typeof parsed === "string") privateKey = parsed;
    } catch {
      privateKey = privateKey.slice(1, -1);
    }
  }
  privateKey = privateKey?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new ApiError(
      503,
      "Firebase não está configurado. Defina FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY nas variáveis de ambiente.",
    );
  }
  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

export function getFirestoreDb() {
  if (firestore) return firestore;
  const app = getAdminApp();
  firestore = getFirestore(app);
  return firestore;
}

export async function getFirebaseAuth(): Promise<Auth> {
  if (firebaseAuth) return firebaseAuth;
  const { getAuth } = await import("firebase-admin/auth");
  firebaseAuth = getAuth(getAdminApp());
  return firebaseAuth;
}

export type RecordData = Record<string, unknown> & { id: string };

export async function getRecord<T extends RecordData = RecordData>(
  collection: string,
  id: string,
): Promise<T | undefined> {
  const snapshot = await getFirestoreDb().collection(collection).doc(id).get();
  return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as T) : undefined;
}

export async function listRecords<T extends RecordData = RecordData>(
  collection: string,
  filters: Record<string, unknown> = {},
): Promise<T[]> {
  let query: FirebaseFirestore.Query = getFirestoreDb().collection(collection);
  for (const [field, value] of Object.entries(filters)) query = query.where(field, "==", value);
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T);
}

export async function setRecord(
  collection: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await getFirestoreDb().collection(collection).doc(id).set(data, { merge: true });
}

export async function deleteRecord(collection: string, id: string): Promise<void> {
  await getFirestoreDb().collection(collection).doc(id).delete();
}

export async function deleteRecords(collection: string, field: string, value: unknown): Promise<void> {
  const db = getFirestoreDb();
  const snapshot = await db.collection(collection).where(field, "==", value).get();
  const batches: FirebaseFirestore.WriteBatch[] = [];
  let batch = db.batch();
  let count = 0;
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    if (++count === 450) {
      batches.push(batch);
      batch = db.batch();
      count = 0;
    }
  }
  if (count) batches.push(batch);
  await Promise.all(batches.map((item) => item.commit()));
}

export function nowIso() {
  return new Date().toISOString();
}
