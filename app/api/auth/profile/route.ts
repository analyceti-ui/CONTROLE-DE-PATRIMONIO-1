import { NextResponse } from "next/server";
import { getSessionUser, handleApiError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getSessionUser(request, true));
  } catch (error) {
    return handleApiError(error);
  }
}
