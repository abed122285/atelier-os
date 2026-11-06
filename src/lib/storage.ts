import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_SIZE_BYTES } from "./validators";

export interface StoredMediaAsset {
  url: string;
  publicUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

const MIME_TO_SAFE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

/**
 * Strict magic-byte verification for PNG (full 8-byte signature), JPEG, and WebP.
 */
export function verifyImageMagicBytes(buf: Uint8Array, declaredMime: string): boolean {
  if (buf.length < 12) return false;
  // PNG full 8-byte signature: 89 50 4E 47 0D 0A 1A 0A
  if (declaredMime === "image/png") {
    return (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    );
  }
  // JPEG: FF D8 FF
  if (declaredMime === "image/jpeg") {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  // WEBP: RIFF....WEBP
  if (declaredMime === "image/webp") {
    return (
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50
    );
  }
  return false;
}

export interface StorageProvider {
  uploadImage(fileBuffer: Buffer, categoryFolder: string, mimeType: string): Promise<StoredMediaAsset>;
  deleteImage(url: string): Promise<void>;
}

/**
 * Production-grade Supabase Storage provider using private buckets and signed URLs.
 * Compatible with Vercel's read-only serverless filesystem and prevents Stored XSS.
 */
export class SupabaseStorageProvider implements StorageProvider {
  private bucketName: string;

  constructor(bucketName = process.env.SUPABASE_STORAGE_BUCKET || "atelier-media") {
    this.bucketName = bucketName;
  }

  async uploadImage(
    fileBuffer: Buffer,
    categoryFolder: string,
    mimeType: string
  ): Promise<StoredMediaAsset> {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType as any)) {
      throw new Error("Unsupported image format. Allowed: JPG, PNG, WebP.");
    }
    if (fileBuffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
      throw new Error("Image size exceeds maximum limit of 5 MB.");
    }
    if (!verifyImageMagicBytes(new Uint8Array(fileBuffer), mimeType)) {
      throw new Error("File binary header does not match declared image MIME type.");
    }

    const safeExt = MIME_TO_SAFE_EXT[mimeType];
    if (!safeExt) {
      throw new Error("Unsupported image MIME type.");
    }

    const safeCategory = categoryFolder.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "general";
    // Extension is derived strictly from the verified MIME type, never from user filename
    const generatedFileName = `${Date.now()}-${crypto.randomUUID()}${safeExt}`;
    const objectPath = `${safeCategory}/${generatedFileName}`;

    // Use Supabase Storage when configured
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const admin = createSupabaseServiceRoleClient();
      const { error: uploadErr } = await admin.storage
        .from(this.bucketName)
        .upload(objectPath, fileBuffer, {
          contentType: mimeType,
          upsert: false,
        });

      if (!uploadErr) {
        const { data: signedData } = await admin.storage
          .from(this.bucketName)
          .createSignedUrl(objectPath, 60 * 60 * 24 * 7); // 7-day signed URL
        const signedUrl = signedData?.signedUrl || `/storage/${this.bucketName}/${objectPath}`;
        return {
          url: signedUrl,
          publicUrl: signedUrl,
          fileName: generatedFileName,
          mimeType,
          sizeBytes: fileBuffer.byteLength,
        };
      }
    }

    // Fallback for local/offline testing: write to non-public /tmp directory with strict extension
    const fallbackDir = path.join(process.env.TMPDIR || "/tmp", "atelier-uploads", safeCategory);
    await fs.mkdir(fallbackDir, { recursive: true });
    const fullPath = path.join(fallbackDir, generatedFileName);
    await fs.writeFile(fullPath, fileBuffer);

    const safeUrl = `/api/media/${safeCategory}/${generatedFileName}`;
    return {
      url: safeUrl,
      publicUrl: safeUrl,
      fileName: generatedFileName,
      mimeType,
      sizeBytes: fileBuffer.byteLength,
    };
  }

  async deleteImage(url: string): Promise<void> {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const admin = createSupabaseServiceRoleClient();
      await admin.storage.from(this.bucketName).remove([url]).catch(() => undefined);
    }
  }
}

export const storageProvider: StorageProvider = new SupabaseStorageProvider();

export async function saveUploadedImage(
  file: File,
  categoryFolder = "material"
): Promise<StoredMediaAsset> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return storageProvider.uploadImage(buffer, categoryFolder, file.type);
}
