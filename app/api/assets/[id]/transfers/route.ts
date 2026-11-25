import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readImageUploads } from "@/lib/asset-photos";
import { ApiError, getDatabase, getSessionUser, handleApiError, nowIso, requireAdmin, writeAssetHistory, writeAudit } from "@/lib/api";
import { deleteImage, uploadImage } from "@/lib/cloudinary";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const uploaded: Array<{ public_id: string }> = [];
  let committed = false;
  try {
    const user = await getSessionUser(request);
    requireAdmin(user);
    const { id } = await context.params;
    const form = await request.formData();
    const toUid = String(form.get("toUid") ?? "").trim();
    const notes = String(form.get("notes") ?? "").trim();
    if (!toUid) throw new ApiError(400, "Selecione o usuário que está recebendo o equipamento.");
    if (!notes || notes.length > 2000) throw new ApiError(400, "Descreva as condições da entrega (até 2.000 caracteres).");
    const photos = await readImageUploads(form);
    const db = getDatabase();
    const transferId = randomUUID();
    const timestamp = nowIso();
    for (const photo of photos) {
      uploaded.push(await uploadImage(photo.blob, photo.type, `${user.organizationId}/assets/${id}/transfers`));
    }

    let fromUid: string | null = null;
    let recipientName = "";
    let initialDelivery = false;
    await db.runTransaction(async (transaction) => {
      const assetRef = db.collection("assets").doc(id);
      const recipientRef = db.collection("users").doc(toUid);
      const [assetSnap, recipientSnap, deliveries] = await Promise.all([
        transaction.get(assetRef), transaction.get(recipientRef),
        transaction.get(db.collection("asset_transfers").where("asset_id", "==", id)),
      ]);
      if (!assetSnap.exists || assetSnap.data()?.organization_id !== user.organizationId) throw new ApiError(404, "Ativo não encontrado.");
      const asset = assetSnap.data()!;
      if (!recipientSnap.exists || recipientSnap.data()?.organization_id !== user.organizationId || !recipientSnap.data()?.active) {
        throw new ApiError(400, "O usuário selecionado não está ativo nesta organização.");
      }
      recipientName = String(recipientSnap.data()?.display_name ?? "");
      initialDelivery = deliveries.empty;
      if (initialDelivery && toUid !== asset.owner_uid) throw new ApiError(409, "A primeira entrega deve ser registrada para o responsável atual do ativo.");
      if (!initialDelivery && toUid === asset.owner_uid) throw new ApiError(409, "Selecione um novo responsável para transferir o ativo.");
      fromUid = initialDelivery ? null : String(asset.owner_uid);
      transaction.create(db.collection("asset_transfers").doc(transferId), {
        asset_id: id, from_uid: fromUid, to_uid: toUid, actor_uid: user.uid, notes, created_at: timestamp,
      });
      uploaded.forEach((photo, index) => transaction.create(
        db.collection("asset_transfer_photos").doc(randomUUID()),
        {
          transfer_id: transferId, cloudinary_public_id: photo.public_id,
          photo_type: photos[index].type, created_at: timestamp,
        },
      ));
      if (!initialDelivery) transaction.update(assetRef, { owner_uid: toUid, updated_at: timestamp });
    });
    committed = true;
    await writeAssetHistory(id, user.uid, initialDelivery ? "delivery.recorded" : "transferred",
      initialDelivery ? `Entrega inicial registrada para ${recipientName}.` : `Ativo transferido para ${recipientName}.`,
      { fromUid, toUid, notes, photoCount: photos.length });
    await writeAudit(user.organizationId, user.uid, initialDelivery ? "asset.delivery_recorded" : "asset.transferred", "asset", id, {
      fromUid, toUid, photoCount: photos.length,
    });
    return NextResponse.json({ ok: true, initialDelivery }, { status: 201 });
  } catch (error) {
    if (!committed) await Promise.all(uploaded.map((photo) => deleteImage(photo.public_id).catch(() => undefined)));
    return handleApiError(error);
  }
}
