import { NextResponse } from "next/server";
import { ApiError, deleteRecord, deleteRecords, getRecord, getSessionUser, handleApiError, listRecords, nowIso, requireOrganizationUser, setRecord, writeAssetHistory, writeAudit } from "@/lib/api";
import { deleteImage } from "@/lib/cloudinary";

type RouteContext = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
const tables = ["inspections", "service_orders", "asset_photos", "asset_transfers", "vehicle_fuel_records", "maintenance_plans", "asset_history"];

async function loadAsset(request: Request, id: string) {
  const user = await getSessionUser(request);
  const asset = await getRecord("assets", id);
  if (!asset) throw new ApiError(404, "Ativo não encontrado.");
  requireOrganizationUser(user, String(asset.organization_id));
  const sharedWithUids = Array.isArray(asset.shared_with_uids) ? asset.shared_with_uids.map(String) : [];
  if (user.role !== "admin" && asset.owner_uid !== user.uid && !sharedWithUids.includes(user.uid)) throw new ApiError(404, "Ativo não encontrado.");
  return { user, asset };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user, asset } = await loadAsset(request, id);
    const [owner, histories, inspections, serviceOrders, photos, transfers, users, transferPhotos] = await Promise.all([
      getRecord("users", String(asset.owner_uid)),
      listRecords("asset_history", { asset_id: id }),
      listRecords("inspections", { asset_id: id }),
      listRecords("service_orders", { asset_id: id }),
      listRecords("asset_photos", { asset_id: id }),
      listRecords("asset_transfers", { asset_id: id }),
      listRecords("users", { organization_id: user.organizationId }),
      listRecords("asset_transfer_photos"),
    ]);
    const people = new Map(users.map((person) => [person.id, person]));
    const sortRecent = <T extends Record<string, unknown> & { id: string }>(records: T[]) =>
      records.sort((a, b) => String(b["created_at"] ?? "").localeCompare(String(a["created_at"] ?? ""))).slice(0, 100);
    const sharedWithUids = Array.isArray(asset.shared_with_uids) ? asset.shared_with_uids.map(String) : [];
    const visibleAsset = user.role === "admin" ? {
      ...asset,
      shared_with_uids: sharedWithUids,
      shared_with_names: sharedWithUids.map((uid) => String(people.get(uid)?.display_name || people.get(uid)?.email || uid)),
    } : {
      ...asset,
      shared_with_uids: sharedWithUids,
      shared_with_names: sharedWithUids.map((uid) => String(people.get(uid)?.display_name || people.get(uid)?.email || uid)),
      purchase_date: "",
      purchase_cost: 0,
      warranty_until: "",
    };
    return NextResponse.json({
      asset: { ...visibleAsset, ownerEmail: owner?.email ?? "", ownerName: owner?.display_name ?? "" },
      history: sortRecent(histories).map((entry) => ({
        id: entry.id, eventType: entry.event_type, description: entry.description,
        metadataJson: entry.metadata_json ?? "{}", createdAt: entry.created_at,
        actorName: people.get(String(entry.actor_uid))?.display_name ?? null,
      })),
      inspections: sortRecent(inspections).map((item) => ({
        id: item.id, result: item.result, notes: item.notes, checklistJson: item.checklist_json,
        photoType: item.photo_type, createdAt: item.created_at,
      })),
      serviceOrders: sortRecent(serviceOrders).map((item) => ({
        id: item.id, kind: item.kind, description: item.description, priority: item.priority, status: item.status,
        dueDate: item.due_date, laborCost: item.labor_cost, partsCost: item.parts_cost,
        completedAt: item.completed_at, createdAt: item.created_at,
      })),
      photos: sortRecent(photos).map((item) => ({
        id: item.id, photoType: item.photo_type, caption: item.caption, createdAt: item.created_at,
      })),
      transfers: sortRecent(transfers).map((item) => ({
        id: item.id, fromUid: item.from_uid, toUid: item.to_uid, notes: item.notes, createdAt: item.created_at,
        fromName: people.get(String(item.from_uid))?.display_name ?? null,
        fromEmail: people.get(String(item.from_uid))?.email ?? null,
        toName: people.get(String(item.to_uid))?.display_name ?? "",
        toEmail: people.get(String(item.to_uid))?.email ?? "",
        actorName: people.get(String(item.actor_uid))?.display_name ?? null,
        photos: transferPhotos.filter((photo) => photo.transfer_id === item.id).map((photo) => ({
          id: photo.id, transferId: photo.transfer_id, photoType: photo.photo_type,
        })),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user, asset } = await loadAsset(request, id);
    if (user.role !== "admin" && asset.owner_uid !== user.uid) throw new ApiError(403, "Você não tem permissão para remover este ativo.");
    const [assetPhotos, transferRecords, inspections, fuelRecords, serviceOrders, stockTransactions] = await Promise.all([
      listRecords("asset_photos", { asset_id: id }),
      listRecords("asset_transfers", { asset_id: id }),
      listRecords("inspections", { asset_id: id }),
      listRecords("vehicle_fuel_records", { asset_id: id }),
      listRecords("service_orders", { asset_id: id }),
      listRecords("inventory_transactions"),
    ]);
    const transferIds = new Set(transferRecords.map((item) => item.id));
    const transferPhotos = (await listRecords("asset_transfer_photos")).filter((photo) => transferIds.has(String(photo.transfer_id)));
    for (const [entries, fields] of [
      [assetPhotos, ["cloudinary_public_id"]],
      [transferPhotos, ["cloudinary_public_id"]],
      [inspections, ["photo_public_id"]],
      [fuelRecords, ["odometer_photo_public_id", "receipt_photo_public_id"]],
    ] as const) {
      for (const entry of entries) for (const field of fields) {
        if (entry[field]) await deleteImage(String(entry[field]));
      }
    }
    for (const photo of transferPhotos) await deleteRecord("asset_transfer_photos", photo.id);
    for (const table of tables) if (table !== "asset_transfers") await deleteRecords(table, "asset_id", id);
    for (const transfer of transferRecords) await deleteRecord("asset_transfers", transfer.id);
    const orderIds = new Set(serviceOrders.map((order) => order.id));
    for (const transaction of stockTransactions) {
      if (transaction.service_order_id && orderIds.has(String(transaction.service_order_id))) {
        await deleteRecord("inventory_transactions", transaction.id);
      }
    }
    await deleteRecords("audit_log", "entity_id", id);
    await deleteRecord("assets", id);
    await writeAudit(user.organizationId, user.uid, "asset.deleted", "asset", id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user, asset } = await loadAsset(request, id);
    const body = await request.json() as Record<string, unknown>;
    if ("ownerUid" in body) {
      if (user.role !== "admin") throw new ApiError(403, "Somente administradores podem alterar o responsável pelo ativo.");
      throw new ApiError(400, "Para registrar a entrega ou troca de responsável, use o formulário de transferência com fotos e observações.");
    }
    if ("sharedWithUids" in body) {
      if (user.role !== "admin") throw new ApiError(403, "Somente administradores podem alterar usuários autorizados.");
      if (!Array.isArray(body.sharedWithUids)) throw new ApiError(400, "Usuários autorizados inválidos.");
      const sharedWithUids = [...new Set(body.sharedWithUids.filter((uid): uid is string => typeof uid === "string" && uid.trim().length > 0).map((uid) => uid.trim()))];
      if (sharedWithUids.length > 100) throw new ApiError(400, "Selecione no máximo 100 usuários autorizados.");
      for (const uid of sharedWithUids) {
        const person = await getRecord("users", uid);
        if (!person || person.organization_id !== user.organizationId || !person.active) throw new ApiError(400, "Selecione somente usuários ativos da mesma organização.");
      }
    }
    if (user.role !== "admin") {
      for (const field of ["purchaseDate", "purchaseCost", "warrantyUntil", "unitId"]) {
        if (field in body) throw new ApiError(403, "Somente administradores podem alterar dados financeiros ou administrativos do ativo.");
      }
    }
    const fields: Record<string, string> = {
      name: "name", category: "category", tag: "tag", location: "location", status: "status",
      nextMaintenance: "next_maintenance", unitId: "unit_id", manufacturer: "manufacturer", model: "model",
      serialNumber: "serial_number", purchaseDate: "purchase_date", purchaseCost: "purchase_cost",
      warrantyUntil: "warranty_until", vehicleKm: "vehicle_km", usageHours: "usage_hours",
    };
    const changes: Record<string, unknown> = {};
    if (Array.isArray(body.sharedWithUids) && user.role === "admin") {
      changes.shared_with_uids = [...new Set(body.sharedWithUids.filter((uid): uid is string => typeof uid === "string" && uid.trim().length > 0).map((uid) => uid.trim()))].filter((uid) => uid !== asset.owner_uid);
    }
    for (const [field, column] of Object.entries(fields)) {
      if (!(field in body)) continue;
      const value = body[field];
      if (typeof value !== "string" && value !== null && typeof value !== "number") throw new ApiError(400, `O campo ${field} é inválido.`);
      changes[column] = typeof value === "string" ? value.trim() : value;
    }
    if ("details" in body) {
      if (!body.details || typeof body.details !== "object" || Array.isArray(body.details)) throw new ApiError(400, "Detalhes do ativo inválidos.");
      const details = JSON.stringify(body.details);
      if (details.length > 10_000) throw new ApiError(400, "Detalhes excedem o limite permitido.");
      changes.details_json = details;
    }
    for (const field of ["purchase_cost", "vehicle_km", "usage_hours"]) {
      const value = changes[field];
      if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new ApiError(400, "Valor numérico inválido.");
    }
    if (typeof changes.name === "string" && (!changes.name || changes.name.length > 120)) throw new ApiError(400, "O nome do ativo é obrigatório (até 120 caracteres).");
    if (changes.category !== undefined) {
      const categories = await listRecords("asset_categories", { organization_id: user.organizationId });
      if (!["Veículo", "Computador", "Equipamento", "Outro", ...categories.map((x) => String(x.name))].includes(String(changes.category))) throw new ApiError(400, "Categoria inválida.");
    }
    if (changes.status !== undefined) {
      const statuses = await listRecords("asset_statuses", { organization_id: user.organizationId });
      if (!["Em uso", "Disponível", "Em manutenção", "Baixado", ...statuses.map((x) => String(x.name))].includes(String(changes.status))) throw new ApiError(400, "Situação inválida.");
    }
    if (typeof changes.unit_id === "string" && changes.unit_id) {
      if (user.role !== "admin") throw new ApiError(403, "Somente administradores podem alterar a unidade.");
      const unit = await getRecord("units", changes.unit_id);
      if (!unit || unit.organization_id !== user.organizationId) throw new ApiError(400, "Selecione uma unidade válida.");
    }
    if (typeof changes.next_maintenance === "string" && changes.next_maintenance &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(changes.next_maintenance) ||
        Number.isNaN(Date.parse(`${changes.next_maintenance}T00:00:00Z`)) ||
        new Date(`${changes.next_maintenance}T00:00:00Z`).toISOString().slice(0, 10) !== changes.next_maintenance)) {
      throw new ApiError(400, "Informe uma data válida para a próxima preventiva.");
    }
    const textLimits: Record<string, number> = {
      name: 120, tag: 80, location: 120, next_maintenance: 10,
      manufacturer: 120, model: 120, serial_number: 120,
    };
    for (const [field, maxLength] of Object.entries(textLimits)) {
      if (typeof changes[field] === "string" && changes[field].length > maxLength) {
        throw new ApiError(400, `O campo ${field} excede o limite permitido.`);
      }
    }
    if (!Object.keys(changes).length) throw new ApiError(400, "Nenhum campo válido para atualizar.");
    changes.updated_at = nowIso();
    const updated = { ...asset, ...changes };
    await setRecord("assets", id, updated);
    await writeAssetHistory(id, user.uid, "updated", "Dados do ativo atualizados.", changes);
    await writeAudit(user.organizationId, user.uid, "asset.updated", "asset", id, changes);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
