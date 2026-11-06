import { NextRequest, NextResponse } from "next/server";
import { saveUploadedImage, verifyImageMagicBytes } from "@/lib/storage";
import { requirePermission } from "@/lib/auth";
import { PermissionCode } from "@/lib/rbac";
import { enforceRateLimit } from "@/lib/rateLimit";
import { MAX_IMAGE_SIZE_BYTES } from "@/lib/validators";
import { db } from "@/db";
import { attachments, activityLogs } from "@/db/schema";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = MAX_IMAGE_SIZE_BYTES; // 5 MB

const ENTITY_UPLOAD_PERMISSION: Record<string, PermissionCode> = {
  MATERIAL: "inventory.adjust",
  PURCHASE: "purchases.create",
  MODEL: "models.create",
  PRODUCTION_ORDER: "production.update",
  FINISHED_PRODUCT: "production.update",
  SALE: "sales.create",
  INVOICE: "invoices.create",
  EXPENSE: "finance.create_expense",
  SETTINGS: "settings.manage",
};

export const dynamic = "force-dynamic";

function sanitizeEntityName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "MATERIAL";
}

export async function POST(req: NextRequest) {
  const rateLimitResponse = enforceRateLimit(req, {
    namespace: "api:upload:post",
    maxRequests: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_UPLOAD_BYTES + 64 * 1024) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "PAYLOAD_TOO_LARGE", message: "File exceeds 5MB maximum limit" },
        },
        { status: 413 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const entityType = sanitizeEntityName((formData.get("entityType") as string) || "MATERIAL").toUpperCase();
    const entityId = sanitizeEntityName((formData.get("entityId") as string) || "UNASSIGNED");

    const requiredPerm: PermissionCode =
      ENTITY_UPLOAD_PERMISSION[entityType] || "inventory.adjust";

    const auth = await requirePermission(req, requiredPerm);
    if (!auth.ok) {
      return auth.response;
    }

    if (!file) {
      return NextResponse.json(
        { ok: false, error: { code: "MISSING_FILE", message: "No image file provided" } },
        { status: 400 }
      );
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Unsupported image type. Allowed: PNG, JPG, WEBP.",
          },
        },
        { status: 415 }
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "PAYLOAD_TOO_LARGE", message: "File exceeds 5MB maximum limit" },
        },
        { status: 413 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    if (!verifyImageMagicBytes(uint8, file.type)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_MAGIC_BYTES",
            message: "File binary header does not match declared image MIME type.",
          },
        },
        { status: 422 }
      );
    }

    const saved = await saveUploadedImage(file, entityType.toLowerCase());
    let attachmentRecord = null;
    try {
      const [inserted] = await db
        .insert(attachments)
        .values({
          entityType,
          entityId,
          fileName: saved.fileName,
          url: saved.url,
          mimeType: saved.mimeType,
          sizeBytes: saved.sizeBytes,
        })
        .returning();
      attachmentRecord = inserted;

      await db.insert(activityLogs).values({
        actionType: "UPLOAD_ATTACHMENT",
        entityType,
        entityId,
        summaryAr: `رفع صورة مرفقة (${saved.fileName})`,
        summaryFr: `Image téléversée (${saved.fileName})`,
      });
    } catch {
      attachmentRecord = {
        id: `ATT-${Date.now()}`,
        entityType,
        entityId,
        fileName: saved.fileName,
        url: saved.url,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
      };
    }

    return NextResponse.json({ ok: true, data: attachmentRecord }, { status: 201 });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "UPLOAD_FAILED", message: "Image upload could not be processed" } },
      { status: 500 }
    );
  }
}
