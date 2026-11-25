import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { v2 as cloudinary } from "cloudinary";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const overwrite = args.includes("--overwrite");
const inputPath = args.find((arg) => !arg.startsWith("--")) ||
  process.env.LOCAL_DATABASE_PATH || path.join(process.cwd(), "data", "patrimonio.sqlite");

if (overwrite && !apply) {
  throw new Error("--overwrite só pode ser usado junto com --apply.");
}
if (!existsSync(inputPath)) {
  throw new Error(`O arquivo SQLite de origem não foi encontrado: ${inputPath}`);
}

const source = new DatabaseSync(inputPath);
source.exec("PRAGMA query_only = ON;");
const tables = source.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
).all().map(({ name }) => name);
const summaries = tables.map((table) => {
  const identifier = `"${table.replaceAll('"', '""')}"`;
  const columns = source.prepare(`PRAGMA table_info(${identifier})`).all().map(({ name }) => name);
  const count = Number(source.prepare(`SELECT COUNT(*) AS count FROM ${identifier}`).get().count);
  const blobColumns = columns.filter((column) => column.endsWith("_blob"));
  return { table, identifier, columns, count, blobColumns };
});

console.info(`Origem: ${path.resolve(inputPath)}`);
console.info("Registros locais encontrados:");
for (const { table, count, blobColumns } of summaries) {
  console.info(`- ${table}: ${count}${blobColumns.length ? ` (colunas de imagem: ${blobColumns.join(", ")})` : ""}`);
}

if (!apply) {
  console.info("Simulação concluída: nenhum dado foi enviado. Revise a origem e use --apply para executar.");
  source.close();
  process.exit(0);
}

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("Defina SUPABASE_DB_URL no ambiente local antes da migração.");
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;
const hasImages = summaries.some(({ blobColumns }) => blobColumns.length > 0) &&
  summaries.some(({ table, count }) => count > 0 && ["asset_photos", "asset_transfer_photos", "inspections", "vehicle_fuel_records"].includes(table));
if (hasImages && (!cloudName || !apiKey || !apiSecret)) {
  throw new Error("Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET para transferir as fotos.");
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
if (cloudName && apiKey && apiSecret) {
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
}

const uploadedPublicIds = [];
const upload = async (buffer, contentType, folder) => {
  if (!buffer) return null;
  const result = await cloudinary.uploader.upload(
    `data:${contentType};base64,${Buffer.from(buffer).toString("base64")}`,
    {
      folder: `patrimonio/migration/${folder}`,
      resource_type: "image",
      type: "authenticated",
      unique_filename: true,
    },
  );
  uploadedPublicIds.push(result.public_id);
  return { cloudinary_public_id: result.public_id, secure_url: result.secure_url };
};

const normalizeBoolean = (value) => value === 1 || value === true;
const idFieldFor = (table) => table === "users" ? "uid"
  : table === "sessions" ? "token_hash"
    : table === "notification_preferences" ? "user_uid"
      : "id";

try {
  const migration = readFileSync(
    path.join(process.cwd(), "supabase", "migrations", "20261125100000_app_records.sql"),
    "utf8",
  );
  await pool.query(migration);

  const existing = await pool.query("SELECT 1 FROM public.app_records LIMIT 1");
  if (existing.rowCount && !overwrite) {
    throw new Error("O destino Supabase já contém registros. Use um projeto vazio ou --overwrite após conferir os IDs.");
  }

  const client = await pool.connect();
  let migrated = 0;
  try {
    await client.query("BEGIN");
    for (const { table, identifier } of summaries) {
      const rows = source.prepare(`SELECT * FROM ${identifier}`).all();
      for (const original of rows) {
        const row = { ...original };
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

        const idField = idFieldFor(table);
        const id = row[idField] ? String(row[idField]) : randomUUID();
        const data = Object.fromEntries(Object.entries(row).filter(([key]) => key !== idField));
        if (table === "users") {
          data.active = data.active === 0 || data.active === false ? false : true;
          data.must_change_password = normalizeBoolean(data.must_change_password);
          data.email_notifications = normalizeBoolean(data.email_notifications);
        }
        if (table === "notification_preferences") {
          data.in_app = normalizeBoolean(data.in_app);
          data.email_enabled = normalizeBoolean(data.email_enabled);
        }
        await client.query(
          `INSERT INTO public.app_records (collection, id, data)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (collection, id) DO ${overwrite ? "UPDATE SET data = EXCLUDED.data" : "NOTHING"}`,
          [table, id, JSON.stringify(data)],
        );
        if (table === "users" && data.email) {
          const email = String(data.email).trim().toLowerCase();
          const emailId = createHash("sha256").update(email).digest("hex");
          const emailData = {
            email,
            uid: id,
            created_at: data.created_at ?? new Date().toISOString(),
          };
          await client.query(
            `INSERT INTO public.app_records (collection, id, data)
             VALUES ('user_emails', $1, $2::jsonb)
             ON CONFLICT (collection, id) DO ${overwrite ? "UPDATE SET data = EXCLUDED.data" : "NOTHING"}`,
            [emailId, JSON.stringify(emailData)],
          );
        }
        migrated++;
      }
      console.info(`Preparados ${rows.length} registros de ${table}.`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await Promise.all(uploadedPublicIds.map((publicId) =>
      cloudinary.uploader.destroy(publicId, { type: "authenticated", resource_type: "image" }),
    ));
    throw error;
  } finally {
    client.release();
  }
  console.info(`Migração concluída: ${migrated} registros locais foram enviados ao Supabase.`);
} finally {
  source.close();
  await pool.end();
}
