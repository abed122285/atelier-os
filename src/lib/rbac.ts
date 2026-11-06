export const ALL_PERMISSIONS = [
  "dashboard.view",
  "models.view",
  "models.create",
  "models.edit",
  "models.delete",
  "inventory.view",
  "inventory.adjust",
  "purchases.view",
  "purchases.create",
  "production.view",
  "production.create",
  "production.assign",
  "production.update",
  "sales.view",
  "sales.create",
  "sales.edit",
  "sales.cancel",
  "invoices.view",
  "invoices.create",
  "customers.view",
  "customers.create",
  "customers.edit",
  "finance.view",
  "finance.create_expense",
  "reports.view",
  "employees.manage",
  "settings.manage",
] as const;

export type PermissionCode = (typeof ALL_PERMISSIONS)[number];

export const ASSIGNABLE_EMPLOYEE_ROLES = [
  "PRODUCTION_MANAGER",
  "SALES_CASHIER",
  "INVENTORY_PURCHASING",
  "ACCOUNTANT_FINANCE",
] as const;

export type AssignableEmployeeRoleCode = (typeof ASSIGNABLE_EMPLOYEE_ROLES)[number];

export const ROLE_PERMISSION_PRESETS: Record<string, PermissionCode[]> = {
  OWNER_ADMIN: [...ALL_PERMISSIONS],
  PRODUCTION_MANAGER: [
    "dashboard.view",
    "models.view",
    "models.create",
    "models.edit",
    "inventory.view",
    "production.view",
    "production.create",
    "production.assign",
    "production.update",
  ],
  SALES_CASHIER: [
    "dashboard.view",
    "models.view",
    "sales.view",
    "sales.create",
    "invoices.view",
    "invoices.create",
    "customers.view",
    "customers.create",
    "customers.edit",
  ],
  INVENTORY_PURCHASING: [
    "dashboard.view",
    "inventory.view",
    "inventory.adjust",
    "purchases.view",
    "purchases.create",
    "models.view",
  ],
  ACCOUNTANT_FINANCE: [
    "dashboard.view",
    "invoices.view",
    "purchases.view",
    "finance.view",
    "finance.create_expense",
    "reports.view",
  ],
};

export interface AtelierSessionUser {
  id: string;
  organizationId: string;
  username: string;
  fullName: string;
  accountType: "OWNER" | "EMPLOYEE";
  roleCode: string;
  isActive: boolean;
  mfaEnabled: boolean;
  sessionVersion: number;
  permissions: PermissionCode[];
  customGrant?: PermissionCode[];
  customDeny?: PermissionCode[];
}

export function isPermissionCode(value: string): value is PermissionCode {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

export function evaluateUserPermission(
  user: AtelierSessionUser | null | undefined,
  requiredPermission: PermissionCode
): boolean {
  if (!user || !user.isActive) return false;
  if (user.accountType === "OWNER" || user.roleCode === "OWNER_ADMIN") return true;
  if (user.customDeny?.includes(requiredPermission)) return false;
  if (user.customGrant?.includes(requiredPermission)) return true;
  return user.permissions.includes(requiredPermission);
}

export function evaluateAnyUserPermission(
  user: AtelierSessionUser | null | undefined,
  requiredPermissions: readonly PermissionCode[]
): boolean {
  return requiredPermissions.some((perm) => evaluateUserPermission(user, perm));
}
