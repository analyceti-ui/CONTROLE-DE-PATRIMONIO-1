import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readImageUploads } from "@/lib/asset-photos";
import { ApiError, deleteRecord, getSessionUser, handleApiError, listRecords, nowIso, organizationScopedAsset, setRecord, writeAssetHistory, writeAudit } from "@/lib/api";
import { uploadImage, deleteImage } from "@/lib/cloudinary";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser(request);
    const { id } = await context.params;
    await organizationScopedAsset(user, id);
    const photos = (await listRecords("asset_photos", { asset_id: id }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 100)
      .map((photo) => ({ id: photo.id, photoType: photo.photo_type, caption: photo.caption, createdAt: photo.created_at }));
    return NextResponse.json({ photos });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const uploaded: Array<{ public_id: string }> = [];
  const photoIds: string[] = [];
  let committed = false;
  try {
    const user = await getSessionUser(request);
    const { id } = await context.params;
    const asset = await organizationScopedAsset(user, id);
    const form = await request.formData();
    const caption = String(form.get("caption") ?? "").trim();
    if (caption.length > 200) throw new ApiError(400, "A descrição das fotos deve ter até 200 caracteres.");
    const photos = await readImageUploads(form);
    for (const photo of photos) {
      const cloud = await uploadImage(photo.blob, photo.type, `${user.organizationId}/assets/${id}`);
      uploaded.push({ public_id: cloud.public_id });
      const photoId = randomUUID();
      photoIds.push(photoId);
      await setRecord("asset_photos", photoId, {
        asset_id: id, actor_uid: user.uid, cloudinary_public_id: cloud.public_id,
        secure_url: cloud.secure_url, photo_type: photo.type, caption, created_at: nowIso(),
      });
    }
    committed = true;
    await writeAssetHistory(id, user.uid, "photo.added", `Adicionada(s) ${photos.length} foto(s) do equipamento.`, { count: photos.length, caption });
    await writeAudit(user.organizationId, user.uid, "asset.photo_added", "asset", id, { count: photos.length });
    return NextResponse.json({ ok: true, count: photos.length, assetId: String(asset.id) }, { status: 201 });
  } catch (error) {
    if (!committed) {
      await Promise.all(photoIds.map((photoId) => deleteRecord("asset_photos", photoId).catch(() => undefined)));
      await Promise.all(uploaded.map((photo) => deleteImage(photo.public_id).catch(() => undefined)));
    }
    return handleApiError(error);
  }
}
