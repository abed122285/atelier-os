import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  ALL_PERMISSIONS,
  AtelierSessionUser,
  evaluateAnyUserPermission,
  evaluateUserPermission,
  isPermissionCode,
  PermissionCode,
  ROLE_PERMISSION_PRESETS,
} from "@/lib/rbac";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/**
 * RFC 6238 TOTP verification using Node's built-in crypto module.
 * Allows +/- 1 time step (30s) for clock drift and compares codes in constant time.
 */
export function verifyRfc6238Totp(secretBase32: string, code: string, nowMs: number = Date.now()): boolean {
  if (!secretBase32 || !/^\d{6}$/.test(code)) return false;
  const key = decodeBase32(secretBase32);
  if (key.length === 0) return false;

  const currentCounter = Math.floor(nowMs / 1000 / 30);
  const candidateBuf = Buffer.from(code, "utf8");

  for (const offset of [-1, 0, 1]) {
    const counter = currentCounter + offset;
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    counterBuf.writeUInt32BE(counter >>> 0, 4);

    const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
    const byteOffset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[byteOffset] & 0x7f) << 24) |
      ((hmac[byteOffset + 1] & 0xff) << 16) |
      ((hmac[byteOffset + 2] & 0xff) << 8) |
      (hmac[byteOffset + 3] & 0xff);
    const otp = String(binary % 1_000_000).padStart(6, "0");
    const otpBuf = Buffer.from(otp, "utf8");

    if (otpBuf.length === candidateBuf.length && crypto.timingSafeEqual(otpBuf, candidateBuf)) {
      return true;
    }
  }
  return false;
}

export type AuthVerificationResult =
  | { ok: true; user: AtelierSessionUser }
  | { ok: false; status: 401 | 403; code: string; message: string };

/**
 * Resolves and verifies the current authenticated user from the server-side Supabase session
 * and re-derives all role and permission assignments strictly from the database.
 * Never trusts client-supplied role or permission fields.
 */
export async function getAuthenticatedSessionUser(
  req?: Request | NextRequest
): Promise<AuthVerificationResult> {
  try {
    const supabase = createSupabaseServerClient();
    const bearerHeader = req?.headers.get("authorization");
    const bearerToken =
      bearerHeader && bearerHeader.toLowerCase().startsWith("bearer ")
        ? bearerHeader.slice(7).trim()
        : undefined;

    const {
      data: { user: authUser },
      error: authError,
    } = bearerToken ? await supabase.auth.getUser(bearerToken) : await supabase.auth.getUser();

    if (authError || !authUser) {
      return {
        ok: false,
        status: 401,
        code: "UNAUTHENTICATED",
        message: "Valid server-side authentication session is required",
      };
    }

    const admin = createSupabaseServiceRoleClient();

    const { data: profile } = await admin
      .from("profiles")
      .select(
        "id, organization_id, username, full_name, account_type, is_active, mfa_enabled, session_version"
      )
      .eq("id", authUser.id)
      .maybeSingle();

    if (!profile || !profile.is_active) {
      return {
        ok: false,
        status: 401,
        code: "ACCOUNT_INACTIVE",
        message: "Account is inactive or does not exist",
      };
    }

    // Enforce session_version revocation if recorded in user metadata
    const tokenSessionVersion = authUser.user_metadata?.session_version;
    if (
      typeof tokenSessionVersion === "number" &&
      tokenSessionVersion !== profile.session_version
    ) {
      return {
        ok: false,
        status: 401,
        code: "SESSION_REVOKED",
        message: "Session has been revoked; please sign in again",
      };
    }

    // Enforce active membership in the organization
    const { data: membership } = await admin
      .from("memberships")
      .select("status, is_owner")
      .eq("organization_id", profile.organization_id)
      .eq("user_id", profile.id)
      .maybeSingle();

    if (!membership || membership.status !== "ACTIVE") {
      return {
        ok: false,
        status: 403,
        code: "MEMBERSHIP_SUSPENDED",
        message: "Organization membership is not active",
      };
    }

    // Enforce MFA assurance when mfa_enabled is true on the profile
    if (profile.mfa_enabled) {
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const metadataMfaVerifiedVersion = authUser.user_metadata?.mfa_verified_session_version;
      const isAal2 = aalData?.currentLevel === "aal2";
      const isMetadataVerified = metadataMfaVerifiedVersion === profile.session_version;

      if (!isAal2 && !isMetadataVerified) {
        return {
          ok: false,
          status: 401,
          code: "MFA_ASSURANCE_REQUIRED",
          message: "Multi-factor authentication verification is required for this session",
        };
      }
    }

    const isOwner = profile.account_type === "OWNER" || membership.is_owner;
    let roleCode = isOwner ? "OWNER_ADMIN" : "EMPLOYEE";
    let customGrant: PermissionCode[] = [];
    let customDeny: PermissionCode[] = [];

    if (!isOwner) {
      const { data: assignment } = await admin
        .from("user_role_assignments")
        .select("role_id, custom_permissions_grant, custom_permissions_deny")
        .eq("organization_id", profile.organization_id)
        .eq("user_id", profile.id)
        .maybeSingle();

      if (assignment) {
        const { data: roleRow } = await admin
          .from("roles")
          .select("code")
          .eq("id", assignment.role_id)
          .eq("organization_id", profile.organization_id)
          .maybeSingle();

        if (roleRow?.code) {
          roleCode = roleRow.code;
        }
        customGrant = (assignment.custom_permissions_grant || []).filter(isPermissionCode);
        customDeny = (assignment.custom_permissions_deny || []).filter(isPermissionCode);
      }
    }

    const presetPermissions = isOwner
      ? [...ALL_PERMISSIONS]
      : ROLE_PERMISSION_PRESETS[roleCode] || [];

    const effectivePermissions = isOwner
      ? [...ALL_PERMISSIONS]
      : ALL_PERMISSIONS.filter(
          (perm) =>
            !customDeny.includes(perm) &&
            (presetPermissions.includes(perm) || customGrant.includes(perm))
        );

    const sessionUser: AtelierSessionUser = {
      id: profile.id,
      organizationId: profile.organization_id,
      username: profile.username,
      fullName: profile.full_name,
      accountType: profile.account_type,
      roleCode,
      isActive: profile.is_active,
      mfaEnabled: profile.mfa_enabled,
      sessionVersion: profile.session_version,
      permissions: effectivePermissions,
      customGrant,
      customDeny,
    };

    return { ok: true, user: sessionUser };
  } catch {
    return {
      ok: false,
      status: 401,
      code: "AUTH_VERIFICATION_FAILED",
      message: "Unable to verify authentication session",
    };
  }
}

export type PermissionGuardResult =
  | { ok: true; user: AtelierSessionUser }
  | { ok: false; response: NextResponse };

/**
 * Centralized server-side RBAC guard (`requirePermission`).
 * Verifies the caller's server-side session, re-derives role/permissions from the DB,
 * and enforces that the caller holds the required permission(s).
 */
export async function requirePermission(
  req: Request | NextRequest | undefined,
  requiredPermission: PermissionCode | readonly PermissionCode[]
): Promise<PermissionGuardResult> {
  const authResult = await getAuthenticatedSessionUser(req);
  if (!authResult.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: { code: authResult.code, message: authResult.message } },
        { status: authResult.status }
      ),
    };
  }

  const requiredList = Array.isArray(requiredPermission)
    ? requiredPermission
    : [requiredPermission];

  if (!evaluateAnyUserPermission(authResult.user, requiredList)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: {
            code: "RBAC_FORBIDDEN",
            message: `Permission denied: requires '${requiredList.join("' or '")}'`,
          },
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user: authResult.user };
}

/**
 * Authenticates the caller on the server and optionally enforces a required permission.
 */
export async function requireAuthenticatedUser(
  req?: Request | NextRequest,
  requiredPermission?: PermissionCode
): Promise<PermissionGuardResult> {
  if (requiredPermission) {
    return requirePermission(req, requiredPermission);
  }
  const authResult = await getAuthenticatedSessionUser(req);
  if (!authResult.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: { code: authResult.code, message: authResult.message } },
        { status: authResult.status }
      ),
    };
  }
  return { ok: true, user: authResult.user };
}
