import { v2 as cloudinary } from "cloudinary";
import { ApiError } from "@/lib/errors";

function getCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new ApiError(
      503,
      "Cloudinary não está configurado. Defina CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET.",
    );
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return cloudinary;
}

export async function uploadImage(buffer: Buffer, contentType: string, folder: string) {
  const client = getCloudinary();
  const dataUri = `data:${contentType};base64,${buffer.toString("base64")}`;
  const uploaded = await client.uploader.upload(dataUri, {
    folder: `patrimonio/${folder}`,
    resource_type: "image",
    type: "authenticated",
    use_filename: false,
    unique_filename: true,
    overwrite: false,
  });
  return {
    public_id: uploaded.public_id,
    secure_url: uploaded.secure_url,
    format: uploaded.format,
    bytes: uploaded.bytes,
    resource_type: uploaded.resource_type,
  };
}

export function privateImageUrl(publicId: string) {
  const client = getCloudinary();
  return client.url(publicId, {
    secure: true,
    resource_type: "image",
    type: "authenticated",
    sign_url: true,
  });
}

export async function fetchPrivateImage(publicId: string) {
  const response = await fetch(privateImageUrl(publicId), { cache: "force-cache" });
  if (!response.ok) throw new ApiError(502, "Não foi possível carregar a imagem armazenada.");
  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300, stale-while-revalidate=900",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function deleteImage(publicId: string) {
  await getCloudinary().uploader.destroy(publicId, { resource_type: "image", type: "authenticated", invalidate: true });
}
