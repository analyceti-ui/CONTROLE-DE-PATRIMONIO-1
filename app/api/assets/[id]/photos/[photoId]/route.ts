import {
  ApiError,
  deleteRecord,
  getRecord,
  getSessionUser,
  handleApiError,
  listRecords,
  nowIso,
  organizationScopedAsset,
  setRecord,
  writeAssetHistory,
  writeAudit,
} from "@/lib/api";
import { deleteImage, fetchPrivateImage } from "@/lib/cloudinary";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string; photoId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser(request);
    const { id, photoId } = await context.params;
    await organizationScopedAsset(user, id);
    const photo = await getRecord("asset_photos", photoId);
    if (!photo || photo.asset_id !== id || !photo.cloudinary_public_id) throw new ApiError(404, "Foto do equipamento não encontrada.");
    return await fetchPrivateImage(String(photo.cloudinary_public_id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser(request);
    const { id, photoId } = await context.params;
    const asset = await organizationScopedAsset(user, id);
    const photo = await getRecord("asset_photos", photoId);
    if (!photo || photo.asset_id !== id || !photo.cloudinary_public_id) throw new ApiError(404, "Foto do equipamento não encontrada.");
    if (asset.cover_photo_id === photoId) return Response.json({ ok: true, coverPhotoId: photoId });

    await setRecord("assets", id, { cover_photo_id: photoId, updated_at: nowIso() });
    await writeAssetHistory(id, user.uid, "photo.cover_updated", "Foto de capa do equipamento alterada.", { photoId });
    await writeAudit(user.organizationId, user.uid, "asset.photo_cover_updated", "asset", id, { photoId });
    return Response.json({ ok: true, coverPhotoId: photoId });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser(request);
    const { id, photoId } = await context.params;
    const asset = await organizationScopedAsset(user, id);
    const photo = await getRecord("asset_photos", photoId);
    if (!photo || photo.asset_id !== id || !photo.cloudinary_public_id) throw new ApiError(404, "Foto do equipamento não encontrada.");

    const assetPhotos = (await listRecords("asset_photos", { asset_id: id }))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const remainingPhotos = assetPhotos
      .filter((item) => item.id !== photoId);
    const previousCoverId = String(asset.cover_photo_id ?? assetPhotos[0]?.id ?? "");
    const coverPhotoId = previousCoverId === photoId
      ? remainingPhotos[0]?.id ?? null
      : asset.cover_photo_id ?? null;

    if (photo.cloudinary_public_id) await deleteImage(String(photo.cloudinary_public_id));
    await deleteRecord("asset_photos", photoId);
    if (previousCoverId === photoId) {
      await setRecord("assets", id, { cover_photo_id: coverPhotoId, updated_at: nowIso() });
    }

    await writeAssetHistory(id, user.uid, "photo.deleted", "Foto do equipamento removida.", { photoId });
    await writeAudit(user.organizationId, user.uid, "asset.photo_deleted", "asset", id, { photoId });
    return Response.json({ ok: true, coverPhotoId });
  } catch (error) {
    return handleApiError(error);
  }
}
