import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { verifyRfc6238Totp } from "@/lib/auth";
import { ALL_PERMISSIONS, isPermissionCode, PermissionCode, ROLE_PERMISSION_PRESETS } from "@/lib/rbac";
import { checkRateLimitBucket, clearRateLimitBucket, extractClientIp } from "@/lib/rateLimit";

const LoginInputSchema = z.object({
  username: z.string().trim().min(3).max(48).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(8).max(128),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});

const MAX_ATTEMPTS_PER_USER_IP = 5;
const MAX_ATTEMPTS_PER_IP = 20;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(req: NextRequest) {
  try {
    const ip = extractClientIp(req);

    // Global per-IP rate limit before parsing credentials
    const ipLimit = checkRateLimitBucket({
      namespace: "auth:login:ip",
      identifier: ip,
      maxRequests: MAX_ATTEMPTS_PER_IP,
      windowMs: WINDOW_MS,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many login attempts. Please wait 15 minutes before retrying.",
          },
        },
        { status: 429 }
      );
    }

    const body = await req.json();
    const parsed = LoginInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_INPUT", message: "Invalid username or password format" } },
        { status: 422 }
      );
    }

    const { username, password, totpCode } = parsed.data;
    const normalizedUsername = username.toLowerCase();
    const userRateKey = `${ip}:${normalizedUsername}`;

    // Per-username + IP rate limit AND global per-username rate limit (mitigates IP rotation)
    const userIpLimit = checkRateLimitBucket({
      namespace: "auth:login:user_ip",
      identifier: userRateKey,
      maxRequests: MAX_ATTEMPTS_PER_USER_IP,
      windowMs: WINDOW_MS,
    });
    const accountLimit = checkRateLimitBucket({
      namespace: "auth:login:account",
      identifier: normalizedUsername,
      maxRequests: MAX_ATTEMPTS_PER_USER_IP * 2,
      windowMs: WINDOW_MS,
    });

    if (!userIpLimit.allowed || !accountLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many login attempts. Please wait 15 minutes before retrying.",
          },
        },
        { status: 429 }
      );
    }

    // 1. Resolve username to internal_auth_email on the server (never exposed to client)
    const adminClient = createSupabaseServiceRoleClient();
    const { data: profile } = await adminClient
      .from("profiles")
      .select("id, organization_id, username, internal_auth_email, full_name, account_type, is_active, mfa_enabled, session_version")
      .eq("username", normalizedUsername)
      .maybeSingle();

    // Generic error message prevents username enumeration
    if (!profile || !profile.is_active) {
      return NextResponse.json(
        { ok: false, error: { code: "AUTH_FAILED", message: "Invalid credentials or inactive account" } },
        { status: 401 }
      );
    }

    // 2. Authenticate with Supabase Auth using the resolved internal email
    const supabase = createSupabaseServerClient();
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: profile.internal_auth_email,
      password,
    });

    if (authErr || !authData.user) {
      await adminClient.from("audit_logs").insert({
        organization_id: profile.organization_id,
        actor_user_id: profile.id,
        actor_username: profile.username,
        actor_role: profile.account_type,
        event_category: "AUTH",
        action_code: "LOGIN_FAILED",
        entity_type: "PROFILE",
        entity_id: profile.id,
        summary_ar: `محاولة دخول فاشلة للمستخدم ${profile.username}`,
        summary_fr: `Échec de connexion pour l'utilisateur ${profile.username}`,
        ip_address: ip,
      });

      return NextResponse.json(
        { ok: false, error: { code: "AUTH_FAILED", message: "Invalid credentials or inactive account" } },
        { status: 401 }
      );
    }

    // 3. Enforce TOTP / MFA verification when mfa_enabled is true on the profile
    if (profile.mfa_enabled) {
      if (!totpCode) {
        await supabase.auth.signOut();
        return NextResponse.json(
          {
            ok: false,
            mfaRequired: true,
            error: {
              code: "MFA_REQUIRED",
              message: "Two-factor authentication code (TOTP) is required for this account",
            },
          },
          { status: 401 }
        );
      }

      let mfaVerified = false;

      // Primary check: Supabase Auth native MFA TOTP factor challengeAndVerify
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const verifiedTotpFactor = factorsData?.totp?.find((f: any) => f.status === "verified");
      if (verifiedTotpFactor) {
        const { error: mfaErr } = await supabase.auth.mfa.challengeAndVerify({
          factorId: verifiedTotpFactor.id,
          code: totpCode,
        });
        if (!mfaErr) {
          mfaVerified = true;
        }
      } else {
        // Fallback check: RFC 6238 HMAC-SHA1 against server-stored TOTP secret in app_metadata
        const totpSecret =
          (authData.user.app_metadata?.totp_secret as string | undefined) ||
          process.env.ATELIER_OWNER_TOTP_SECRET;
        if (totpSecret && verifyRfc6238Totp(totpSecret, totpCode)) {
          mfaVerified = true;
        }
      }

      if (!mfaVerified) {
        await supabase.auth.signOut();
        await adminClient.from("audit_logs").insert({
          organization_id: profile.organization_id,
          actor_user_id: profile.id,
          actor_username: profile.username,
          actor_role: profile.account_type,
          event_category: "AUTH",
          action_code: "LOGIN_MFA_FAILED",
          entity_type: "PROFILE",
          entity_id: profile.id,
          summary_ar: `فشل التحقق الثنائي (MFA) للمستخدم ${profile.username}`,
          summary_fr: `Échec de vérification MFA (TOTP) pour ${profile.username}`,
          ip_address: ip,
        });

        return NextResponse.json(
          {
            ok: false,
            mfaRequired: true,
            error: { code: "INVALID_MFA_CODE", message: "Invalid or expired two-factor authentication code" },
          },
          { status: 401 }
        );
      }
    }

    // 4. Re-derive role and permissions strictly from the server-side database
    const isOwner = profile.account_type === "OWNER";
    let roleCode = isOwner ? "OWNER_ADMIN" : "EMPLOYEE";
    let customGrant: PermissionCode[] = [];
    let customDeny: PermissionCode[] = [];

    if (!isOwner) {
      const { data: assignment } = await adminClient
        .from("user_role_assignments")
        .select("role_id, custom_permissions_grant, custom_permissions_deny")
        .eq("organization_id", profile.organization_id)
        .eq("user_id", profile.id)
        .maybeSingle();

      if (assignment) {
        const { data: roleRow } = await adminClient
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

    // Stamp current session_version (and MFA verification marker) onto user_metadata
    await adminClient.auth.admin.updateUserById(profile.id, {
      user_metadata: {
        ...authData.user.user_metadata,
        session_version: profile.session_version,
        ...(profile.mfa_enabled ? { mfa_verified_session_version: profile.session_version } : {}),
      },
    });

    // Clear rate limits on success & record login timestamp + audit log
    clearRateLimitBucket("auth:login:user_ip", userRateKey);
    clearRateLimitBucket("auth:login:account", normalizedUsername);

    await adminClient
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", profile.id);

    await adminClient.from("audit_logs").insert({
      organization_id: profile.organization_id,
      actor_user_id: profile.id,
      actor_username: profile.username,
      actor_role: roleCode,
      event_category: "AUTH",
      action_code: "LOGIN_SUCCESS",
      entity_type: "PROFILE",
      entity_id: profile.id,
      summary_ar: `تسجيل دخول ناجح للمستخدم ${profile.username}`,
      summary_fr: `Connexion réussie pour ${profile.username}`,
      ip_address: ip,
    });

    // Return sanitized profile with server-derived role and permissions (without internal_auth_email)
    return NextResponse.json({
      ok: true,
      user: {
        id: profile.id,
        organizationId: profile.organization_id,
        username: profile.username,
        fullName: profile.full_name,
        accountType: profile.account_type,
        roleCode,
        permissions: effectivePermissions,
        isActive: profile.is_active,
        mfaEnabled: profile.mfa_enabled,
        sessionVersion: profile.session_version,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "AUTH_ERROR", message: "Authentication service unavailable" } },
      { status: 500 }
    );
  }
}
