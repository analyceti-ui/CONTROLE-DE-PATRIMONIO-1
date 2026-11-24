import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readImageUploads } from "@/lib/asset-photos";
import { ApiError, deleteRecord, getRecord, getSessionUser, handleApiError, requireAdmin, setRecord, writeAssetHistory, writeAudit } from "@/lib/api";
import { deleteImage, uploadImage } from "@/lib/cloudinary";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string; transferId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const uploaded: Array<{ public_id: string }> = [];
  const photoIds: string[] = [];
  let committed = false;
  try {
    const user = await getSessionUser(request);
    requireAdmin(user);
    const { id, transferId } = await context.params;
    const transfer = await getRecord("asset_transfers", transferId);
    if (!transfer || transfer.asset_id !== id) throw new ApiError(404, "Entrega ou transferência não encontrada.");
    const asset = await getRecord("assets", id);
    if (!asset || asset.organization_id !== user.organizationId) throw new ApiError(404, "Ativo não encontrado.");

    const form = await request.formData();
    const photos = await readImageUploads(form);
    const timestamp = new Date().toISOString();

    for (const photo of photos) {
      const cloud = await uploadImage(photo.blob, photo.type, `${user.organizationId}/assets/${id}/transfers`);
      uploaded.push({ public_id: cloud.public_id });
      const photoId = randomUUID();
      photoIds.push(photoId);
      await setRecord("asset_transfer_photos", photoId, {
        transfer_id: transferId,
        cloudinary_public_id: cloud.public_id,
        photo_type: photo.type,
        created_at: timestamp,
      });
    }

    committed = true;
    await writeAssetHistory(id, user.uid, "transfer.photos_added", `Adicionada(s) ${photos.length} foto(s) ao registro da entrega ou transferência.`, { transferId, count: photos.length });
    await writeAudit(user.organizationId, user.uid, "asset.transfer_photos_added", "asset_transfer", transferId, { assetId: id, count: photos.length });
    return NextResponse.json({ ok: true, count: photos.length }, { status: 201 });
  } catch (error) {
    if (!committed) {
      await Promise.all(photoIds.map((photoId) => deleteRecord("asset_transfer_photos", photoId).catch(() => undefined)));
      await Promise.all(uploaded.map((photo) => deleteImage(photo.public_id).catch(() => undefined)));
    }
    return handleApiError(error);
  }
}
