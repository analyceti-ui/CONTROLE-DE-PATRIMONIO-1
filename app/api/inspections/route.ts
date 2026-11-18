import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, getSessionUser, handleApiError, listRecords, nowIso, organizationScopedAsset, setRecord, writeAssetHistory, writeAudit } from "@/lib/api";
import { deleteImage, uploadImage } from "@/lib/cloudinary";

export const runtime = "nodejs";
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const [assets, rows, users] = await Promise.all([
      listRecords("assets", { organization_id: user.organizationId }),
      listRecords("inspections"),
      listRecords("users", { organization_id: user.organizationId }),
    ]);
    const assetMap = new Map(assets.filter((asset) => user.role === "admin" || asset.owner_uid === user.uid).map((asset) => [asset.id, asset]));
    const userMap = new Map(users.map((person) => [person.id, person]));
    const inspections = rows.filter((entry) => assetMap.has(String(entry.asset_id)))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 500)
      .map((entry) => ({
        id: entry.id, assetId: entry.asset_id, result: entry.result, notes: entry.notes,
        checklistJson: entry.checklist_json, photoType: entry.photo_type, createdAt: entry.created_at,
        assetName: assetMap.get(String(entry.asset_id))?.name,
        inspectorName: userMap.get(String(entry.user_uid))?.display_name,
      }));
    return NextResponse.json({ inspections });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  let uploaded: { public_id: string } | undefined;
  let saved = false;
  try {
    const user = await getSessionUser(request);
    const form = await request.formData();
    const assetId = String(form.get("assetId") ?? "");
    const result = String(form.get("result") ?? "");
    const notes = String(form.get("notes") ?? "").trim();
    const checklistText = String(form.get("checklist") ?? "{}");
    await organizationScopedAsset(user, assetId);
    if (!["Aprovada", "Com ressalvas", "Reprovada"].includes(result)) throw new ApiError(400, "Selecione o resultado da inspeção.");
    if (notes.length > 2000) throw new ApiError(400, "As observações devem ter até 2.000 caracteres.");
    let checklist: unknown;
    try { checklist = JSON.parse(checklistText); } catch { throw new ApiError(400, "Checklist inválido."); }
    if (!checklist || typeof checklist !== "object" || Array.isArray(checklist) || checklistText.length > 5000) {
      throw new ApiError(400, "Checklist inválido ou muito extenso.");
    }
    const file = form.get("photo");
    let photoType: string | null = null;
    if (file instanceof File && file.size > 0) {
      if (!allowedTypes.has(file.type)) throw new ApiError(400, "A foto deve ser JPG, PNG ou WebP.");
      if (file.size > 3.5 * 1024 * 1024) throw new ApiError(400, "A foto deve ter até 3,5 MB para o envio seguro.");
      const buffer = Buffer.from(await file.arrayBuffer());
      const sigValid = file.type === "image/jpeg" ? buffer[0] === 0xff && buffer[1] === 0xd8
        : file.type === "image/png" ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
      if (!sigValid) throw new ApiError(400, "A foto não corresponde ao formato informado.");
      uploaded = await uploadImage(buffer, file.type, `${user.organizationId}/assets/${assetId}/inspections`);
      photoType = file.type;
    }
    const id = randomUUID();
    await setRecord("inspections", id, {
      asset_id: assetId, user_uid: user.uid, result, notes, checklist_json: JSON.stringify(checklist),
      photo_public_id: uploaded?.public_id ?? null, photo_type: photoType, created_at: nowIso(),
    });
    saved = true;
    await writeAssetHistory(assetId, user.uid, "inspection.created", `Inspeção ${result.toLowerCase()}.`, { id, result });
    await writeAudit(user.organizationId, user.uid, "inspection.created", "inspection", id);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (uploaded && !saved) await deleteImage(uploaded.public_id).catch(() => undefined);
    return handleApiError(error);
  }
}
