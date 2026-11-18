import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, getSessionUser, handleApiError, listRecords, readJson, requireAdmin, setRecord, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const items = (await listRecords("inventory_items", { organization_id: user.organizationId }))
      .sort((a, b) => {
        const lowA = Number(a.quantity) <= Number(a.minimum_quantity) ? 0 : 1;
        const lowB = Number(b.quantity) <= Number(b.minimum_quantity) ? 0 : 1;
        return lowA - lowB || String(a.name).localeCompare(String(b.name));
      });
    return NextResponse.json({ items });
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
    const sku = typeof body.sku === "string" ? body.sku.trim() : "";
    const unit = typeof body.unit === "string" ? body.unit.trim() : "un";
    const quantity = Number(body.quantity ?? 0);
    const minimumQuantity = Number(body.minimumQuantity ?? 0);
    const unitCost = Number(body.unitCost ?? 0);
    if (!name || name.length > 120 || sku.length > 80 || unit.length > 20) throw new ApiError(400, "Informe nome, código e unidade válidos.");
    if ([quantity, minimumQuantity, unitCost].some((value) => !Number.isFinite(value) || value < 0)) throw new ApiError(400, "Quantidade e custo devem ser números iguais ou maiores que zero.");
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    await setRecord("inventory_items", id, {
      organization_id: user.organizationId, name, sku, unit, quantity,
      minimum_quantity: minimumQuantity, unit_cost: unitCost, created_at: timestamp, updated_at: timestamp,
    });
    await writeAudit(user.organizationId, user.uid, "inventory.created", "inventory_item", id, { name, quantity });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
