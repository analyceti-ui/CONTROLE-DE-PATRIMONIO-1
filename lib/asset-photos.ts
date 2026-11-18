import { ApiError } from "@/lib/api";

const imageSignatures: Record<string, (bytes: Buffer) => boolean> = {
  "image/jpeg": (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/png": (bytes) =>
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (bytes) =>
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP",
};

export async function readImageUploads(form: FormData, fieldName = "photos") {
  const files = form.getAll(fieldName).filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > 6) throw new ApiError(400, "Envie no máximo 6 fotos por vez.");
  if (!files.length) throw new ApiError(400, "Anexe pelo menos uma foto.");

  const photos: { blob: Buffer; type: string }[] = [];
  let totalSize = 0;
  for (const file of files) {
    if (!(file.type in imageSignatures)) {
      throw new ApiError(400, "As fotos devem estar no formato JPG, PNG ou WebP.");
    }
    if (file.size > 4 * 1024 * 1024) throw new ApiError(400, "Cada foto pode ter até 4 MB.");
    totalSize += file.size;
    if (totalSize > 3.5 * 1024 * 1024) throw new ApiError(400, "O conjunto de fotos pode ter até 3,5 MB para o envio seguro.");
    const blob = Buffer.from(await file.arrayBuffer());
    if (!imageSignatures[file.type](blob)) {
      throw new ApiError(400, "Uma das fotos não corresponde ao formato informado.");
    }
    photos.push({ blob, type: file.type });
  }
  return photos;
}
