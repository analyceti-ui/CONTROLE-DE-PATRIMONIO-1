import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, getSessionUser, handleApiError, listRecords, readJson, requireAdmin, setRecord, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const units = (await listRecords("units", { organization_id: user.organizationId }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(({ id, name }) => ({ id, name }));
    const response = NextResponse.json({ units });
    response.headers.set("Cache-Control", "private, max-age=300, stale-while-revalidate=900");
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(request);
    requireAdmin(user);
    const body = await readJson(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) throw new ApiError(400, "Informe o nome da unidade (até 100 caracteres).");
    const existing = await listRecords("units", { organization_id: user.organizationId });
    if (existing.some((unit) => String(unit.name).toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) throw new ApiError(409, "Esta unidade já existe.");
    const id = randomUUID();
    await setRecord("units", id, { organization_id: user.organizationId, name, created_at: new Date().toISOString() });
    await writeAudit(user.organizationId, user.uid, "unit.created", "unit", id, { name });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
