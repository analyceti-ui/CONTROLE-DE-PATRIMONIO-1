import { ApiError, getSessionUser, handleApiError, requireAdmin } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    requireAdmin(user);
    throw new ApiError(410, "Backups SQLite locais foram desativados. Seus dados na nuvem são armazenados no Firestore; gerencie exportações pelo console do Firebase.");
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  return GET(request);
}
