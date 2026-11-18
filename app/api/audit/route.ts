import { NextResponse } from "next/server";
import { getSessionUser, handleApiError, listRecords, requireAdmin } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    requireAdmin(user);
    const [entries, users] = await Promise.all([
      listRecords("audit_log", { organization_id: user.organizationId }),
      listRecords("users", { organization_id: user.organizationId }),
    ]);
    const people = new Map(users.map((person) => [person.id, person]));
    const result = entries.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 500)
      .map((entry) => ({
        ...entry,
        actorName: people.get(String(entry.actor_uid))?.display_name ?? null,
        actorEmail: people.get(String(entry.actor_uid))?.email ?? null,
      }));
    return NextResponse.json({ entries: result });
  } catch (error) {
    return handleApiError(error);
  }
}
