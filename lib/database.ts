import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import { ApiError } from "@/lib/errors";

type JsonRecord = Record<string, unknown>;
export type RecordData = JsonRecord & { id: string };
type Filter = { field: string; operator: "==" | "in"; value: unknown };

let pool: Pool | undefined;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new ApiError(503, "Supabase não está configurado. Defina SUPABASE_DB_URL nas variáveis de ambiente do servidor.");
  }
  const config: PoolConfig = {
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  };
  const sslCertificate = process.env.SUPABASE_DB_SSL_CERT;
  if (sslCertificate) {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    config.connectionString = url.toString();
    config.ssl = { ca: sslCertificate, rejectUnauthorized: true };
  }
  pool = new Pool(config);
  return pool;
}

function serialize(value: unknown) {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("O registro não pode ser convertido para JSON.");
  return json;
}

function validateCollection(collection: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(collection)) throw new TypeError("Nome de coleção inválido.");
}

function validateField(field: string) {
  if (field !== "__name__" && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
    throw new TypeError("Campo de consulta inválido.");
  }
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Os dados do registro devem ser um objeto JSON.");
  }
  return value as JsonRecord;
}

function asDatabaseError(error: unknown): never {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    if (code === "23505") throw new ApiError(409, "Já existe um registro com esses dados.");
    if (code === "42P01") {
      throw new ApiError(503, "A estrutura do Supabase ainda não foi criada. Execute a migração SQL inicial.");
    }
  }
  throw error;
}

export class PostgresDocumentReference {
  constructor(readonly collectionName: string, readonly id: string) {
    validateCollection(collectionName);
  }

  async get() {
    try {
      const result = await getPool().query<{ data: JsonRecord }>(
        "SELECT data FROM public.app_records WHERE collection = $1 AND id = $2",
        [this.collectionName, this.id],
      );
      return new PostgresDocumentSnapshot(this, result.rows[0]?.data);
    } catch (error) {
      asDatabaseError(error);
    }
  }

  async set(data: JsonRecord, options?: { merge?: boolean }) {
    const value = asRecord(data);
    const merge = options?.merge === true;
    try {
      await getPool().query(
        `INSERT INTO public.app_records (collection, id, data)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (collection, id) DO UPDATE
         SET data = ${merge ? "public.app_records.data || EXCLUDED.data" : "EXCLUDED.data"}`,
        [this.collectionName, this.id, serialize(value)],
      );
    } catch (error) {
      asDatabaseError(error);
    }
  }

  async update(data: JsonRecord) {
    try {
      const result = await getPool().query(
        "UPDATE public.app_records SET data = data || $3::jsonb WHERE collection = $1 AND id = $2",
        [this.collectionName, this.id, serialize(asRecord(data))],
      );
      if (!result.rowCount) throw new ApiError(404, "Registro não encontrado.");
    } catch (error) {
      asDatabaseError(error);
    }
  }

  async delete() {
    try {
      await getPool().query(
        "DELETE FROM public.app_records WHERE collection = $1 AND id = $2",
        [this.collectionName, this.id],
      );
    } catch (error) {
      asDatabaseError(error);
    }
  }
}

export class PostgresDocumentSnapshot {
  readonly exists: boolean;

  constructor(readonly ref: PostgresDocumentReference, private readonly value?: JsonRecord) {
    this.exists = value !== undefined;
  }

  get id() {
    return this.ref.id;
  }

  data() {
    return this.value ? { ...this.value } : undefined;
  }
}

export class PostgresQuerySnapshot {
  constructor(readonly docs: PostgresQueryDocumentSnapshot[]) {}

  get empty() {
    return this.docs.length === 0;
  }

  get size() {
    return this.docs.length;
  }
}

export class PostgresQueryDocumentSnapshot extends PostgresDocumentSnapshot {
  constructor(ref: PostgresDocumentReference, value: JsonRecord) {
    super(ref, value);
  }

  data() {
    return super.data()!;
  }
}

export class PostgresQuery {
  protected readonly filters: Filter[];
  protected readonly rowLimit?: number;

  constructor(readonly collectionName: string, filters: Filter[] = [], rowLimit?: number) {
    validateCollection(collectionName);
    this.filters = filters;
    this.rowLimit = rowLimit;
  }

  where(field: string, operator: "==" | "in", value: unknown) {
    validateField(field);
    if (operator === "in" && !Array.isArray(value)) {
      throw new TypeError("O operador in requer uma lista de valores.");
    }
    return new PostgresQuery(
      this.collectionName,
      [...this.filters, { field, operator, value }],
      this.rowLimit,
    );
  }

  limit(count: number) {
    if (!Number.isInteger(count) || count < 0 || count > 10_000) {
      throw new RangeError("O limite da consulta deve ser um inteiro entre 0 e 10000.");
    }
    return new PostgresQuery(this.collectionName, this.filters, count);
  }

  protected buildSql() {
    const parameters: unknown[] = [this.collectionName];
    const clauses = ["collection = $1"];
    for (const filter of this.filters) {
      if (filter.field === "__name__") {
        if (filter.operator === "==") {
          parameters.push(String(filter.value));
          clauses.push(`id = $${parameters.length}`);
        } else {
          const values = (filter.value as unknown[]).map(String);
          if (!values.length) {
            clauses.push("FALSE");
          } else {
            parameters.push(values);
            clauses.push(`id = ANY($${parameters.length}::text[])`);
          }
        }
        continue;
      }

      const values = filter.operator === "in" ? filter.value as unknown[] : [filter.value];
      if (!values.length) {
        clauses.push("FALSE");
        continue;
      }
      const matches = values.map((value) => {
        parameters.push(filter.field, serialize(value));
        return `data @> jsonb_build_object($${parameters.length - 1}::text, $${parameters.length}::jsonb)`;
      });
      clauses.push(`(${matches.join(" OR ")})`);
    }

    let sql = `SELECT id, data FROM public.app_records WHERE ${clauses.join(" AND ")}`;
    if (this.rowLimit !== undefined) {
      parameters.push(this.rowLimit);
      sql += ` LIMIT $${parameters.length}`;
    }
    return { sql, parameters };
  }

  async get(client: PoolClient | Pool = getPool()) {
    const { sql, parameters } = this.buildSql();
    try {
      const result = await client.query<QueryResultRow & { id: string; data: JsonRecord }>(sql, parameters);
      return new PostgresQuerySnapshot(
        result.rows.map((row) => new PostgresQueryDocumentSnapshot(
          new PostgresDocumentReference(this.collectionName, row.id),
          row.data,
        )),
      );
    } catch (error) {
      asDatabaseError(error);
    }
  }
}

export class PostgresCollection extends PostgresQuery {
  doc(id: string) {
    if (!id || id.length > 512) throw new TypeError("Identificador de registro inválido.");
    return new PostgresDocumentReference(this.collectionName, id);
  }
}

export class PostgresTransaction {
  constructor(private readonly client: PoolClient) {}

  get(reference: PostgresDocumentReference): Promise<PostgresDocumentSnapshot>;
  get(query: PostgresQuery): Promise<PostgresQuerySnapshot>;
  async get(target: PostgresDocumentReference | PostgresQuery) {
    if (target instanceof PostgresDocumentReference) {
      const result = await this.client.query<{ data: JsonRecord }>(
        "SELECT data FROM public.app_records WHERE collection = $1 AND id = $2",
        [target.collectionName, target.id],
      );
      return new PostgresDocumentSnapshot(target, result.rows[0]?.data);
    }
    return target.get(this.client);
  }

  async create(reference: PostgresDocumentReference, data: JsonRecord) {
    try {
      await this.client.query(
        "INSERT INTO public.app_records (collection, id, data) VALUES ($1, $2, $3::jsonb)",
        [reference.collectionName, reference.id, serialize(asRecord(data))],
      );
    } catch (error) {
      asDatabaseError(error);
    }
  }

  async set(reference: PostgresDocumentReference, data: JsonRecord, options?: { merge?: boolean }) {
    const value = serialize(asRecord(data));
    await this.client.query(
      `INSERT INTO public.app_records (collection, id, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (collection, id) DO UPDATE
       SET data = ${options?.merge ? "public.app_records.data || EXCLUDED.data" : "EXCLUDED.data"}`,
      [reference.collectionName, reference.id, value],
    );
  }

  async update(reference: PostgresDocumentReference, data: JsonRecord) {
    const result = await this.client.query(
      "UPDATE public.app_records SET data = data || $3::jsonb WHERE collection = $1 AND id = $2",
      [reference.collectionName, reference.id, serialize(asRecord(data))],
    );
    if (!result.rowCount) throw new ApiError(404, "Registro não encontrado.");
  }

  async delete(reference: PostgresDocumentReference) {
    await this.client.query(
      "DELETE FROM public.app_records WHERE collection = $1 AND id = $2",
      [reference.collectionName, reference.id],
    );
  }
}

export class PostgresDatabase {
  collection(name: string) {
    return new PostgresCollection(name);
  }

  async runTransaction<T>(callback: (transaction: PostgresTransaction) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
          const result = await callback(new PostgresTransaction(client));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
          if ((code === "40001" || code === "40P01") && attempt < 2) continue;
          asDatabaseError(error);
        }
      }
    } finally {
      client.release();
    }
  }
}

let database: PostgresDatabase | undefined;

export function getDatabase() {
  if (!database) database = new PostgresDatabase();
  return database;
}

export async function getRecord<T extends JsonRecord & { id: string } = JsonRecord & { id: string }>(
  collection: string,
  id: string,
): Promise<T | undefined> {
  const snapshot = await getDatabase().collection(collection).doc(id).get();
  return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data()! } as T) : undefined;
}

export async function listRecords<T extends JsonRecord & { id: string } = JsonRecord & { id: string }>(
  collection: string,
  filters: Record<string, unknown> = {},
): Promise<T[]> {
  let query: PostgresQuery = getDatabase().collection(collection);
  for (const [field, value] of Object.entries(filters)) query = query.where(field, "==", value);
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data()! }) as T);
}

export async function listRecordsMatchingAny<T extends JsonRecord & { id: string } = JsonRecord & { id: string }>(
  collection: string,
  field: string,
  candidateValues: readonly unknown[],
): Promise<T[]> {
  const values = [...new Set(candidateValues.filter((value) => value !== null && value !== undefined))];
  if (!values.length) return [];
  const chunks = Array.from({ length: Math.ceil(values.length / 250) }, (_, index) =>
    values.slice(index * 250, (index + 1) * 250),
  );
  const snapshots = await Promise.all(chunks.map((chunk) =>
    getDatabase().collection(collection).where(field, "in", chunk).get(),
  ));
  return snapshots.flatMap((snapshot) =>
    snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T),
  );
}

export async function setRecord(collection: string, id: string, data: JsonRecord) {
  await getDatabase().collection(collection).doc(id).set(data, { merge: true });
}

export async function deleteRecord(collection: string, id: string) {
  await getDatabase().collection(collection).doc(id).delete();
}

export async function deleteRecords(collection: string, field: string, value: unknown) {
  validateCollection(collection);
  validateField(field);
  const sql = field === "__name__"
    ? "DELETE FROM public.app_records WHERE collection = $1 AND id = $2"
    : "DELETE FROM public.app_records WHERE collection = $1 AND data @> jsonb_build_object($2::text, $3::jsonb)";
  const parameters = field === "__name__"
    ? [collection, String(value)]
    : [collection, field, serialize(value)];
  try {
    await getPool().query(sql, parameters);
  } catch (error) {
    asDatabaseError(error);
  }
}

export function nowIso() {
  return new Date().toISOString();
}
