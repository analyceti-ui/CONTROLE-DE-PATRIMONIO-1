import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { ApiError, getSessionUser, handleApiError, organizationScopedAsset } from "@/lib/api";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await getSessionUser(request);
    const { id } = await context.params;
    const asset = await organizationScopedAsset(user, id);
    const ownerAllowed = user.role === "admin" || asset.owner_uid === user.uid;
    if (!ownerAllowed) throw new ApiError(404, "Ativo não encontrado.");
    const url = new URL("/painel", request.url);
    url.searchParams.set("asset", id);
    const svg = await QRCode.toString(url.toString(), { type: "svg", margin: 2, width: 240 });
    return new NextResponse(svg, {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
