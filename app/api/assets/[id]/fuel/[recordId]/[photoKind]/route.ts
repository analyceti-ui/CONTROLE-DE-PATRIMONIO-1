import { ApiError, getRecord, getSessionUser, handleApiError, organizationScopedAsset } from "@/lib/api";
import { fetchPrivateImage } from "@/lib/cloudinary";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string; recordId: string; photoKind: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser(request);
    const { id, recordId, photoKind } = await context.params;
    await organizationScopedAsset(user, id);
    const record = await getRecord("vehicle_fuel_records", recordId);
    const field = photoKind === "odometer" ? "odometer_photo_public_id"
      : photoKind === "receipt" ? "receipt_photo_public_id" : "";
    if (!field) throw new ApiError(400, "Tipo de foto inválido.");
    if (!record || record.asset_id !== id || !record[field]) throw new ApiError(404, "Foto do abastecimento não encontrada.");
    return await fetchPrivateImage(String(record[field]));
  } catch (error) {
    return handleApiError(error);
  }
}
