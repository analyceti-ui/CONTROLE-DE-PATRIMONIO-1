import { ApiError, getRecord, getSessionUser, handleApiError, requireOrganizationUser } from "@/lib/api";
import { fetchPrivateImage } from "@/lib/cloudinary";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser(request);
    const { id } = await context.params;
    const inspection = await getRecord("inspections", id);
    if (!inspection?.photo_public_id) throw new ApiError(404, "Foto não encontrada.");
    const asset = await getRecord("assets", String(inspection.asset_id));
    if (!asset) throw new ApiError(404, "Foto não encontrada.");
    requireOrganizationUser(user, String(asset.organization_id));
    if (user.role !== "admin" && asset.owner_uid !== user.uid) throw new ApiError(404, "Foto não encontrada.");
    return await fetchPrivateImage(String(inspection.photo_public_id));
  } catch (error) {
    return handleApiError(error);
  }
}
