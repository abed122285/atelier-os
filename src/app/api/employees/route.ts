import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rateLimit";
import {
  ALL_PERMISSIONS,
  ASSIGNABLE_EMPLOYEE_ROLES,
  AtelierSessionUser,
  evaluateUserPermission,
  PermissionCode,
  ROLE_PERMISSION_PRESETS,
} from "@/lib/rbac";

const PermissionEnum = z.enum(ALL_PERMISSIONS);
const RoleCodeEnum = z.enum(ASSIGNABLE_EMPLOYEE_ROLES);

const CreateEmployeeSchema = z.object({
  username: z.string().trim().min(3).max(48).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(10).max(128),
  fullName: z.string().min(2).max(120),
  roleCode: RoleCodeEnum,
  jobTitleAr: z.string().max(120).optional().default(""),
  jobTitleFr: z.string().max(120).optional().default(""),
  phone: z.string().max(40).optional().default(""),
  customPermissionsGrant: z.array(PermissionEnum).optional().default([]),
  customPermissionsDeny: z.array(PermissionEnum).optional().default([]),
});

const UpdateEmployeeAccessSchema = z.object({
  employeeId: z.string().uuid(),
  isActive: z.boolean().optional(),
  revokeSessions: z.boolean().optional(),
  roleCode: RoleCodeEnum.optional(),
  customPermissionsGrant: z.array(PermissionEnum).optional(),
  customPermissionsDeny: z.array(PermissionEnum).optional(),
});

/**
 * Prevents privilege escalation: a non-Owner manager cannot assign a role or custom permission
 * that contains permissions the caller does not personally hold.
 */
function callerHoldsAllTargetPermissions(
  caller: AtelierSessionUser,
  roleCode?: string,
  customGrant?: PermissionCode[]
): boolean {
  if (caller.accountType === "OWNER" || caller.roleCode === "OWNER_ADMIN") {
    return true;
  }
  const rolePerms = roleCode ? ROLE_PERMISSION_PRESETS[roleCode] || [] : [];
  const requestedPerms = [...rolePerms, ...(customGrant || [])];
  return requestedPerms.every((perm) => evaluateUserPermission(caller, perm));
}

export async function POST(req: NextRequest) {
  const rateLimitResponse = enforceRateLimit(req, {
    namespace: "api:employees:post",
    maxRequests: 15,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const auth = await requirePermission(req, "employees.manage");
    if (!auth.ok) {
      return auth.response;
    }
    const caller = auth.user;

    const body = await req.json();
    const parsed = CreateEmployeeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid employee payload" } },
        { status: 422 }
      );
    }

    const data = parsed.data;

    if (!callerHoldsAllTargetPermissions(caller, data.roleCode, data.customPermissionsGrant)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "PRIVILEGE_ESCALATION_BLOCKED",
            message: "Cannot grant permissions or roles that exceed your own permission set",
          },
        },
        { status: 403 }
      );
    }

    const uname = data.username.toLowerCase();
    const internalEmail = `${uname}@atelier.afafelassli.dz`;
    const admin = createSupabaseServiceRoleClient();

    // 1. Create Supabase Auth user with password managed by Supabase Auth
    const { data: createdAuth, error: authErr } = await admin.auth.admin.createUser({
      email: internalEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        username: uname,
        full_name: data.fullName,
        account_type: "EMPLOYEE",
        session_version: 1,
      },
    });

    if (authErr || !createdAuth.user) {
      return NextResponse.json(
        { ok: false, error: { code: "CREATE_AUTH_FAILED", message: "Failed to create employee credentials" } },
        { status: 409 }
      );
    }

    const empId = createdAuth.user.id;
    const { data: roleRecord } = await admin
      .from("roles")
      .select("id")
      .eq("organization_id", caller.organizationId)
      .eq("code", data.roleCode)
      .single();

    if (!roleRecord) {
      return NextResponse.json(
        { ok: false, error: { code: "ROLE_NOT_FOUND", message: "Specified role does not exist" } },
        { status: 400 }
      );
    }

    // 2. Create Profile, Membership & Role Assignment (Employee can NEVER be created as OWNER)
    await admin.from("profiles").insert({
      id: empId,
      organization_id: caller.organizationId,
      username: uname,
      internal_auth_email: internalEmail,
      full_name: data.fullName,
      account_type: "EMPLOYEE",
      job_title_ar: data.jobTitleAr,
      job_title_fr: data.jobTitleFr,
      phone: data.phone,
      is_active: true,
      created_by: caller.id,
    });

    await admin.from("memberships").insert({
      organization_id: caller.organizationId,
      user_id: empId,
      is_owner: false,
      status: "ACTIVE",
    });

    await admin.from("user_role_assignments").insert({
      organization_id: caller.organizationId,
      user_id: empId,
      role_id: roleRecord.id,
      custom_permissions_grant: data.customPermissionsGrant,
      custom_permissions_deny: data.customPermissionsDeny,
      assigned_by: caller.id,
    });

    await admin.from("audit_logs").insert({
      organization_id: caller.organizationId,
      actor_user_id: caller.id,
      actor_username: caller.username,
      actor_role: caller.accountType,
      event_category: "RBAC",
      action_code: "EMPLOYEE_CREATED",
      entity_type: "PROFILE",
      entity_id: empId,
      summary_ar: `إنشاء حساب موظف جديد (${uname}) بدور ${data.roleCode}`,
      summary_fr: `Création du compte employé (${uname}) avec le rôle ${data.roleCode}`,
    });

    return NextResponse.json(
      { ok: true, employee: { id: empId, username: uname, fullName: data.fullName, roleCode: data.roleCode, isActive: true } },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "SERVER_ERROR", message: "Failed to create employee" } },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const rateLimitResponse = enforceRateLimit(req, {
    namespace: "api:employees:patch",
    maxRequests: 15,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const auth = await requirePermission(req, "employees.manage");
    if (!auth.ok) {
      return auth.response;
    }
    const caller = auth.user;

    const body = await req.json();
    const parsed = UpdateEmployeeAccessSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid update payload" } },
        { status: 422 }
      );
    }

    const { employeeId, isActive, revokeSessions, roleCode, customPermissionsGrant, customPermissionsDeny } =
      parsed.data;

    // Prevent non-Owner administrators from modifying their own permissions or escalating privileges
    if (caller.accountType !== "OWNER" && employeeId === caller.id) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "SELF_MODIFICATION_FORBIDDEN",
            message: "Non-owner administrators cannot modify their own role or permission grants",
          },
        },
        { status: 403 }
      );
    }

    if (!callerHoldsAllTargetPermissions(caller, roleCode, customPermissionsGrant)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "PRIVILEGE_ESCALATION_BLOCKED",
            message: "Cannot grant permissions or roles that exceed your own permission set",
          },
        },
        { status: 403 }
      );
    }

    const admin = createSupabaseServiceRoleClient();

    // Prevent modifying Owner account status or self-lockout
    const { data: targetProfile } = await admin
      .from("profiles")
      .select("id, username, account_type, session_version")
      .eq("id", employeeId)
      .eq("organization_id", caller.organizationId)
      .single();

    if (!targetProfile || targetProfile.account_type === "OWNER") {
      return NextResponse.json(
        { ok: false, error: { code: "PROTECTED_OWNER", message: "Owner account cannot be deactivated or demoted" } },
        { status: 403 }
      );
    }

    const nextSessionVersion =
      revokeSessions || isActive === false || roleCode || customPermissionsGrant || customPermissionsDeny
        ? targetProfile.session_version + 1
        : targetProfile.session_version;

    await admin
      .from("profiles")
      .update({
        ...(typeof isActive === "boolean" ? { is_active: isActive } : {}),
        session_version: nextSessionVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", employeeId);

    if (typeof isActive === "boolean") {
      await admin
        .from("memberships")
        .update({ status: isActive ? "ACTIVE" : "SUSPENDED", updated_at: new Date().toISOString() })
        .eq("user_id", employeeId)
        .eq("organization_id", caller.organizationId);
    }

    if (roleCode || customPermissionsGrant || customPermissionsDeny) {
      let nextRoleId: string | undefined;
      if (roleCode) {
        const { data: roleRecord } = await admin
          .from("roles")
          .select("id")
          .eq("organization_id", caller.organizationId)
          .eq("code", roleCode)
          .single();
        if (!roleRecord) {
          return NextResponse.json(
            { ok: false, error: { code: "ROLE_NOT_FOUND", message: "Specified role does not exist" } },
            { status: 400 }
          );
        }
        nextRoleId = roleRecord.id;
      }

      await admin
        .from("user_role_assignments")
        .update({
          ...(nextRoleId ? { role_id: nextRoleId } : {}),
          ...(customPermissionsGrant ? { custom_permissions_grant: customPermissionsGrant } : {}),
          ...(customPermissionsDeny ? { custom_permissions_deny: customPermissionsDeny } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", employeeId)
        .eq("organization_id", caller.organizationId);
    }

    if (revokeSessions || isActive === false) {
      await admin.auth.admin.signOut(employeeId);
    }

    await admin.from("audit_logs").insert({
      organization_id: caller.organizationId,
      actor_user_id: caller.id,
      actor_username: caller.username,
      actor_role: caller.accountType,
      event_category: "RBAC",
      action_code: isActive === false ? "EMPLOYEE_DEACTIVATED" : revokeSessions ? "SESSION_REVOKED" : "PERMISSIONS_UPDATED",
      entity_type: "PROFILE",
      entity_id: employeeId,
      summary_ar: `تحديث صلاحيات/حالة حساب الموظف (${targetProfile.username})`,
      summary_fr: `Mise à jour des accès de l'employé (${targetProfile.username})`,
    });

    return NextResponse.json({ ok: true, employeeId, isActive, sessionVersion: nextSessionVersion });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "SERVER_ERROR", message: "Failed to update employee" } },
      { status: 500 }
    );
  }
}
