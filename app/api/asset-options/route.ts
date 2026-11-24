import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, getSessionUser, handleApiError, listRecords, readJson, requireAdmin, setRecord, writeAudit } from "@/lib/api";

export const runtime = "nodejs";
const defaults = {
  categories: ["Veículo", "Computador", "Equipamento", "Outro"],
  statuses: ["Em uso", "Disponível", "Em manutenção", "Baixado"],
};

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const [categories, statuses] = await Promise.all([
      listRecords("asset_categories", { organization_id: user.organizationId }),
      listRecords("asset_statuses", { organization_id: user.organizationId }),
    ]);
    const response = NextResponse.json({
      categories: [...defaults.categories, ...categories.map(({ name }) => String(name)).filter((name) => !defaults.categories.includes(name))],
      statuses: [...defaults.statuses, ...statuses.map(({ name }) => String(name)).filter((name) => !defaults.statuses.includes(name))],
    });
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
    const kind = body.kind === "category" || body.kind === "status" ? body.kind : null;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!kind) throw new ApiError(400, "Selecione se deseja criar uma categoria ou uma situação.");
    if (!name || name.length > 60) throw new ApiError(400, "Informe um nome com até 60 caracteres.");
    const builtIns = defaults[kind === "category" ? "categories" : "statuses"];
    if (builtIns.some((item) => item.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) throw new ApiError(409, "Essa opção já existe como padrão.");
    const table = kind === "category" ? "asset_categories" : "asset_statuses";
    const existing = await listRecords(table, { organization_id: user.organizationId });
    if (existing.some((item) => String(item.name).toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
      throw new ApiError(409, "Essa opção já está cadastrada.");
    }
    const id = randomUUID();
    await setRecord(table, id, { organization_id: user.organizationId, name, created_at: new Date().toISOString() });
    await writeAudit(user.organizationId, user.uid, `asset_${kind}.created`, `asset_${kind}`, id, { name });
    return NextResponse.json({ id, name }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
