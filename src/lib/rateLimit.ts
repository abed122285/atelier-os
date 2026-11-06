import { NextRequest, NextResponse } from "next/server";

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_KEYS = 10_000;
const buckets = new Map<string, RateLimitBucket>();

function pruneExpiredBuckets(now: number) {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  buckets.forEach((entry, key) => {
    if (now > entry.resetAt) {
      buckets.delete(key);
    }
  });
  // If still full, evict oldest inserted key
  if (buckets.size >= MAX_TRACKED_KEYS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey) buckets.delete(oldestKey);
  }
}

/**
 * Extracts client IP preferring platform-verified headers (x-real-ip / x-vercel-forwarded-for)
 * to mitigate trivial X-Forwarded-For spoofing.
 */
export function extractClientIp(req: Request | NextRequest): string {
  const vercelIp = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercelIp) return vercelIp;

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  return "127.0.0.1";
}

export interface RateLimitOptions {
  namespace: string;
  identifier: string;
  maxRequests: number;
  windowMs: number;
}

export function checkRateLimitBucket(options: RateLimitOptions): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  pruneExpiredBuckets(now);

  const key = `${options.namespace}:${options.identifier}`;
  const existing = buckets.get(key);

  if (!existing || now > existing.resetAt) {
    const resetAt = now + options.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: options.maxRequests - 1, resetAt };
  }

  if (existing.count >= options.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, options.maxRequests - existing.count),
    resetAt: existing.resetAt,
  };
}

export function clearRateLimitBucket(namespace: string, identifier: string): void {
  buckets.delete(`${namespace}:${identifier}`);
}

export function enforceRateLimit(
  req: Request | NextRequest,
  options: Omit<RateLimitOptions, "identifier"> & { identifier?: string }
): NextResponse | null {
  const ip = extractClientIp(req);
  const identifier = options.identifier ? `${ip}:${options.identifier}` : ip;
  const result = checkRateLimitBucket({
    namespace: options.namespace,
    identifier,
    maxRequests: options.maxRequests,
    windowMs: options.windowMs,
  });

  if (!result.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please wait before retrying.",
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
        },
      }
    );
  }

  return null;
}
