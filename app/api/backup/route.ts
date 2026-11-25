import { ApiError, getSessionUser, handleApiError, requireAdmin } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    requireAdmin(user);
    throw new ApiError(410, "Backups SQLite locais foram desativados. Seus dados na nuvem são armazenados no Supabase; gerencie backups pelo painel do Supabase.");
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  return GET(request);
}
