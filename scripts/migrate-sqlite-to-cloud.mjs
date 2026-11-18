import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { v2 as cloudinary } from "cloudinary";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;
if (!projectId || !clientEmail || !privateKey || !cloudName || !apiKey || !apiSecret) {
  console.error("Configure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY e as três variáveis CLOUDINARY_* antes de migrar.");
  process.exitCode = 1;
} else {
  const inputPath = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ||
    process.env.LOCAL_DATABASE_PATH || path.join(process.cwd(), "data", "patrimonio.sqlite");
  if (!existsSync(inputPath)) throw new Error(`O arquivo SQLite de origem não foi encontrado: ${inputPath}`);
  const db = new DatabaseSync(inputPath);
  db.exec("PRAGMA query_only = ON;");
  const firebase = getApps()[0] ?? initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
  const firestore = getFirestore(firebase);
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }) => name);

  const existing = [];
  for (const collection of [...tables, "user_emails"]) {
    const snapshot = await firestore.collection(collection).limit(1).get();
    if (!snapshot.empty) existing.push(collection);
  }
  if (existing.length && !process.argv.includes("--overwrite")) {
    console.error(`Já há dados no Firestore (${existing.join(", ")}). Use outro projeto vazio ou passe --overwrite para atualizar os mesmos IDs.`);
    process.exitCode = 1;
  } else {
    let batch = firestore.batch();
    let batchSize = 0;
    let migrated = 0;
    const flush = async () => {
      if (!batchSize) return;
      await batch.commit();
      batch = firestore.batch();
      batchSize = 0;
    };
    const upload = async (buffer, contentType, folder) => {
      if (!buffer) return null;
      const result = await cloudinary.uploader.upload(
        `data:${contentType};base64,${Buffer.from(buffer).toString("base64")}`,
        { folder: `patrimonio/migration/${folder}`, resource_type: "image", type: "authenticated", unique_filename: true },
      );
      return { cloudinary_public_id: result.public_id, secure_url: result.secure_url };
    };

    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all();
      for (const source of rows) {
        const row = { ...source };
        if (table === "asset_photos" && row.photo_blob) {
          Object.assign(row, await upload(row.photo_blob, row.photo_type, `assets/${row.asset_id}`));
          delete row.photo_blob;
        } else if (table === "asset_transfer_photos" && row.photo_blob) {
          Object.assign(row, await upload(row.photo_blob, row.photo_type, "transfers"));
          delete row.photo_blob;
        } else if (table === "inspections" && row.photo_blob) {
          const image = await upload(row.photo_blob, row.photo_type, `inspections/${row.asset_id}`);
          row.photo_public_id = image?.cloudinary_public_id ?? null;
          delete row.photo_blob;
        } else if (table === "vehicle_fuel_records") {
          const odometer = await upload(row.odometer_photo_blob, row.odometer_photo_type, `fuel/${row.asset_id}`);
          const receipt = await upload(row.receipt_photo_blob, row.receipt_photo_type, `fuel/${row.asset_id}`);
          row.odometer_photo_public_id = odometer?.cloudinary_public_id ?? null;
          row.receipt_photo_public_id = receipt?.cloudinary_public_id ?? null;
          delete row.odometer_photo_blob;
          delete row.receipt_photo_blob;
        }

        const idField = table === "users" ? "uid"
          : table === "sessions" ? "token_hash"
            : table === "notification_preferences" ? "user_uid"
              : "id";
        const id = row[idField] ? String(row[idField]) : randomUUID();
        const data = Object.fromEntries(Object.entries(row).filter(([key]) => key !== idField));
        if (table === "users") {
          data.active = data.active === 0 || data.active === false ? false : true;
          data.must_change_password = data.must_change_password === 1 || data.must_change_password === true;
          data.email_notifications = data.email_notifications === 1 || data.email_notifications === true;
        }
        if (table === "notification_preferences") {
          data.in_app = data.in_app === 1 || data.in_app === true;
          data.email_enabled = data.email_enabled === 1 || data.email_enabled === true;
        }
        batch.set(firestore.collection(table).doc(id), data, { merge: true });
        batchSize++;
        if (table === "users" && data.email) {
          const emailId = createHash("sha256").update(String(data.email).trim().toLowerCase()).digest("hex");
          batch.set(firestore.collection("user_emails").doc(emailId), {
            email: String(data.email).trim().toLowerCase(), uid: id, created_at: data.created_at ?? new Date().toISOString(),
          }, { merge: true });
          batchSize++;
        }
        if (batchSize >= 400) await flush();
        migrated++;
      }
      console.info(`Migrados ${rows.length} registros de ${table}.`);
    }
    await flush();
    console.info(`Migração concluída: ${migrated} registros enviados ao Firestore.`);
  }
  db.close();
}
