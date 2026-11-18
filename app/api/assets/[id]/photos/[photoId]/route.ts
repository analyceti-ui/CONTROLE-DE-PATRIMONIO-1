import { ApiError, getRecord, getSessionUser, handleApiError, organizationScopedAsset } from "@/lib/api";
import { fetchPrivateImage } from "@/lib/cloudinary";

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
