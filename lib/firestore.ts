import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, type Firestore } from "firebase-admin/firestore";
import { ApiError } from "@/lib/errors";

let firestore: Firestore | undefined;

export function getFirestoreDb() {
  if (firestore) return firestore;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new ApiError(
      503,
      "Firebase não está configurado. Defina FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY nas variáveis de ambiente.",
    );
  }
  const app = getApps()[0] ?? initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
  firestore = getFirestore(app);
  return firestore;
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

export async function listRecordsMatchingAny<T extends RecordData = RecordData>(
  collection: string,
  field: string,
  candidateValues: readonly unknown[],
): Promise<T[]> {
  const values = [...new Set(candidateValues.filter((value) => value !== null && value !== undefined))];
  if (!values.length) return [];

  const db = getFirestoreDb();
  const queryField = field === "__name__" ? FieldPath.documentId() : field;
  const snapshots = await Promise.all(
    Array.from({ length: Math.ceil(values.length / 30) }, (_, index) =>
      db.collection(collection)
        .where(queryField, "in", values.slice(index * 30, (index + 1) * 30))
        .get(),
    ),
  );
  return snapshots.flatMap((snapshot) =>
    snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T),
  );
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
