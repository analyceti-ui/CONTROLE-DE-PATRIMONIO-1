import { ApiError, getRecord, getSessionUser, handleApiError, organizationScopedAsset } from "@/lib/api";
import { fetchPrivateImage } from "@/lib/cloudinary";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string; transferId: string; photoId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser(request);
    const { id, transferId, photoId } = await context.params;
    await organizationScopedAsset(user, id);
    const [transfer, photo] = await Promise.all([
      getRecord("asset_transfers", transferId),
      getRecord("asset_transfer_photos", photoId),
    ]);
    if (!transfer || transfer.asset_id !== id || !photo || photo.transfer_id !== transferId || !photo.cloudinary_public_id) {
      throw new ApiError(404, "Foto da entrega não encontrada.");
    }
    return await fetchPrivateImage(String(photo.cloudinary_public_id));
  } catch (error) {
    return handleApiError(error);
  }
}
