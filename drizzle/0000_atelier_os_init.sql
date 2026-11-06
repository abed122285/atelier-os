-- ============================================================================
-- ATELIER OS — Complete PostgreSQL / SQLite Compatible DDL Schema Migration
-- Brand Reference: AFAF EL ASSLI (عفاف الأصلي)
-- Total Tables: 33 Core Operational, Inventory, Production & Financial Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS workshop_settings (
  id TEXT PRIMARY KEY,
  workshop_name_ar TEXT NOT NULL DEFAULT 'دار عفاف الأصلي للأزياء الراقية',
  workshop_name_fr TEXT NOT NULL DEFAULT 'Maison AFAF EL ASSLI Haute Couture',
  logo_url TEXT NOT NULL DEFAULT '/assets/afaf-el-assli-logo.png',
  address_ar TEXT NOT NULL DEFAULT 'حي حيدرة، الجزائر العاصمة، الجزائر',
  address_fr TEXT NOT NULL DEFAULT 'Hydra, Alger, Algérie',
  wilaya TEXT NOT NULL DEFAULT '16 - Alger',
  phone TEXT NOT NULL DEFAULT '+213 550 16 88 42',
  email TEXT NOT NULL DEFAULT 'atelier@afafelassli.dz',
  rc_number TEXT DEFAULT '16/00-4829103B24',
  nif_number TEXT DEFAULT '002416048291038',
  default_language TEXT NOT NULL DEFAULT 'ar',
  currency TEXT NOT NULL DEFAULT 'DZD',
  timezone TEXT NOT NULL DEFAULT 'Africa/Algiers',
  date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  invoice_prefix TEXT NOT NULL DEFAULT 'FAC-2026-',
  next_invoice_sequence INTEGER NOT NULL DEFAULT 1001,
  default_invoice_lang TEXT NOT NULL DEFAULT 'bilingual',
  tax_enabled INTEGER NOT NULL DEFAULT 0,
  default_tax_rate NUMERIC(6,2) NOT NULL DEFAULT 0.00,
  prevent_negative_stock INTEGER NOT NULL DEFAULT 1,
  costing_method TEXT NOT NULL DEFAULT 'MOVING_WEIGHTED_AVERAGE',
  theme_mode TEXT NOT NULL DEFAULT 'light',
  invoice_footer_ar TEXT,
  invoice_footer_fr TEXT,
  last_backup_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL CHECK (domain IN ('MATERIAL', 'PRODUCT', 'EXPENSE')),
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  city TEXT NOT NULL DEFAULT 'Alger',
  address TEXT,
  notes TEXT,
  total_purchases NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  total_paid NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  outstanding_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  supplier_id TEXT REFERENCES suppliers(id),
  description TEXT,
  color TEXT,
  unit TEXT NOT NULL,
  on_hand_qty NUMERIC(14,3) NOT NULL DEFAULT 0.000 CHECK (on_hand_qty >= 0),
  reserved_qty NUMERIC(14,3) NOT NULL DEFAULT 0.000 CHECK (reserved_qty >= 0),
  available_qty NUMERIC(14,3) NOT NULL DEFAULT 0.000,
  min_stock_threshold NUMERIC(14,3) NOT NULL DEFAULT 5.000,
  average_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  last_purchase_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  storage_location TEXT DEFAULT 'Rayon A1',
  primary_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS material_images (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt_text TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS material_stock_movements (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  material_id TEXT NOT NULL REFERENCES materials(id),
  movement_type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT', 'RESERVE', 'RELEASE')),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  balance_after_on_hand NUMERIC(14,3) NOT NULL,
  balance_after_available NUMERIC(14,3) NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  purchase_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  purchase_date TEXT NOT NULL,
  due_date TEXT,
  receipt_status TEXT NOT NULL DEFAULT 'DRAFT',
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  shipping_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  remaining_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  notes TEXT,
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id),
  ordered_qty NUMERIC(14,3) NOT NULL CHECK (ordered_qty > 0),
  received_qty NUMERIC(14,3) NOT NULL DEFAULT 0.000 CHECK (received_qty >= 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  line_total NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  payment_reference TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  purchase_id TEXT REFERENCES purchases(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  description TEXT,
  available_colors TEXT NOT NULL DEFAULT '[]',
  available_sizes TEXT NOT NULL DEFAULT '[]',
  expected_production_hours NUMERIC(8,2) NOT NULL DEFAULT 6.00,
  estimated_labor_cost NUMERIC(14,2) NOT NULL DEFAULT 2500.00,
  default_selling_price NUMERIC(14,2) NOT NULL DEFAULT 18500.00,
  primary_image_url TEXT,
  production_notes TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS model_images (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt_text TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS model_variants (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  sku TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  selling_price NUMERIC(14,2) NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill_of_materials (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  batch_size INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill_of_material_items (
  id TEXT PRIMARY KEY,
  bom_id TEXT NOT NULL REFERENCES bill_of_materials(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id),
  quantity_per_unit NUMERIC(14,3) NOT NULL CHECK (quantity_per_unit > 0),
  wastage_percent NUMERIC(6,2) NOT NULL DEFAULT 0.00,
  stage_note TEXT
);

CREATE TABLE IF NOT EXISTS production_stages (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS production_orders (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  order_number TEXT NOT NULL UNIQUE,
  model_id TEXT NOT NULL REFERENCES models(id),
  bom_id TEXT NOT NULL REFERENCES bill_of_materials(id),
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  requested_qty INTEGER NOT NULL CHECK (requested_qty > 0),
  produced_qty INTEGER NOT NULL DEFAULT 0,
  accepted_qty INTEGER NOT NULL DEFAULT 0,
  rejected_qty INTEGER NOT NULL DEFAULT 0,
  current_stage_code TEXT NOT NULL DEFAULT 'PLANNED',
  status TEXT NOT NULL DEFAULT 'PLANNED',
  materials_reserved INTEGER NOT NULL DEFAULT 0,
  materials_issued INTEGER NOT NULL DEFAULT 0,
  stock_completed INTEGER NOT NULL DEFAULT 0,
  planned_start_date TEXT NOT NULL,
  expected_completion_date TEXT NOT NULL,
  completed_at TEXT,
  estimated_material_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  actual_material_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  direct_labor_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  actual_total_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  actual_unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  assigned_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS production_order_stages (
  id TEXT PRIMARY KEY,
  production_order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  qty_entered INTEGER NOT NULL DEFAULT 0,
  qty_accepted INTEGER NOT NULL DEFAULT 0,
  qty_rejected INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS production_consumptions (
  id TEXT PRIMARY KEY,
  production_order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id),
  planned_qty NUMERIC(14,3) NOT NULL,
  reserved_qty NUMERIC(14,3) NOT NULL DEFAULT 0.000,
  actual_consumed_qty NUMERIC(14,3) NOT NULL DEFAULT 0.000,
  waste_qty NUMERIC(14,3) NOT NULL DEFAULT 0.000,
  unit_cost_at_issue NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  total_actual_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  waste_reason TEXT
);

CREATE TABLE IF NOT EXISTS quality_checks (
  id TEXT PRIMARY KEY,
  production_order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  inspected_qty INTEGER NOT NULL,
  accepted_qty INTEGER NOT NULL,
  rejected_qty INTEGER NOT NULL,
  rework_qty INTEGER NOT NULL DEFAULT 0,
  measurements_pass INTEGER NOT NULL DEFAULT 1,
  stitching_pass INTEGER NOT NULL DEFAULT 1,
  embroidery_pass INTEGER NOT NULL DEFAULT 1,
  cleanliness_pass INTEGER NOT NULL DEFAULT 1,
  result TEXT NOT NULL,
  notes TEXT,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finished_products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  model_id TEXT NOT NULL REFERENCES models(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  on_hand_qty INTEGER NOT NULL DEFAULT 0 CHECK (on_hand_qty >= 0),
  reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  available_qty INTEGER NOT NULL DEFAULT 0,
  min_stock_threshold INTEGER NOT NULL DEFAULT 2,
  unit_production_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  selling_price NUMERIC(14,2) NOT NULL,
  primary_image_url TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finished_product_images (
  id TEXT PRIMARY KEY,
  finished_product_id TEXT NOT NULL REFERENCES finished_products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt_text TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finished_stock_movements (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  finished_product_id TEXT NOT NULL REFERENCES finished_products(id),
  movement_type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  balance_after INTEGER NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  secondary_phone TEXT,
  wilaya TEXT NOT NULL DEFAULT '16 - Alger',
  address TEXT,
  measurements_json TEXT DEFAULT '{}',
  notes TEXT,
  total_purchases NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  total_paid NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  outstanding_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  last_purchase_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  sale_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  sale_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  subtotal NUMERIC(14,2) NOT NULL,
  line_discount_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  order_discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  total_amount NUMERIC(14,2) NOT NULL,
  total_cogs NUMERIC(14,2) NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  finished_product_id TEXT NOT NULL REFERENCES finished_products(id),
  product_sku_snapshot TEXT NOT NULL,
  product_name_ar_snapshot TEXT NOT NULL,
  product_name_fr_snapshot TEXT NOT NULL,
  color_snapshot TEXT NOT NULL,
  size_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  returned_qty INTEGER NOT NULL DEFAULT 0,
  unit_price NUMERIC(14,2) NOT NULL,
  unit_cost_snapshot NUMERIC(14,2) NOT NULL,
  line_discount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  line_total NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  document_status TEXT NOT NULL DEFAULT 'ISSUED',
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  workshop_snapshot_json TEXT NOT NULL,
  customer_snapshot_json TEXT NOT NULL,
  subtotal NUMERIC(14,2) NOT NULL,
  discount_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  total_amount NUMERIC(14,2) NOT NULL,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  refunded_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  net_paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  remaining_balance NUMERIC(14,2) NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  sku_snapshot TEXT NOT NULL,
  description_ar_snapshot TEXT NOT NULL,
  description_fr_snapshot TEXT NOT NULL,
  color_snapshot TEXT NOT NULL,
  size_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  line_discount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  line_total NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  payment_reference TEXT NOT NULL UNIQUE,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  external_ref TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  refund_reference TEXT NOT NULL UNIQUE,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  finished_product_id TEXT REFERENCES finished_products(id),
  returned_quantity INTEGER NOT NULL DEFAULT 0,
  return_condition TEXT NOT NULL DEFAULT 'RESTOCK',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  refund_method TEXT NOT NULL,
  reason TEXT NOT NULL,
  refund_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  expense_number TEXT NOT NULL UNIQUE,
  title_ar TEXT NOT NULL,
  title_fr TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  beneficiary TEXT,
  expense_date TEXT NOT NULL,
  description TEXT,
  attachment_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  movement_reference TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  category TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  description TEXT NOT NULL,
  movement_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary_ar TEXT NOT NULL,
  summary_fr TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- LAYER 3 DEFENSE-IN-DEPTH: MULTI-TENANT ORGANIZATION SCOPING & RLS POLICIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'DZD',
  timezone TEXT NOT NULL DEFAULT 'Africa/Algiers',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  internal_auth_email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('OWNER', 'EMPLOYEE')),
  job_title_ar TEXT DEFAULT '',
  job_title_fr TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  session_version INTEGER NOT NULL DEFAULT 1,
  last_login_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS permissions (
  code TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  description_ar TEXT NOT NULL,
  description_fr TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS user_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  custom_permissions_grant TEXT[] NOT NULL DEFAULT '{}',
  custom_permissions_deny TEXT[] NOT NULL DEFAULT '{}',
  assigned_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID,
  actor_username TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  event_category TEXT NOT NULL,
  action_code TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary_ar TEXT NOT NULL,
  summary_fr TEXT NOT NULL,
  ip_address TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure multi-tenant organization_id column exists on all 33 operational tables
ALTER TABLE workshop_settings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE material_images ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE material_stock_movements ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE models ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE model_images ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE model_variants ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE bill_of_materials ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE bill_of_material_items ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE production_stages ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE production_order_stages ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE production_consumptions ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE quality_checks ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE finished_products ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE finished_product_images ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE finished_stock_movements ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Server-side RBAC helper functions for PostgreSQL RLS enforcement
CREATE OR REPLACE FUNCTION public.is_org_member(target_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.organization_id = target_org_id
      AND m.user_id = auth.uid()
      AND m.status = 'ACTIVE'
      AND p.is_active = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(target_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.organization_id = target_org_id
      AND m.user_id = auth.uid()
      AND m.status = 'ACTIVE'
      AND m.is_owner = TRUE
      AND p.account_type = 'OWNER'
      AND p.is_active = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.has_atelier_permission(target_org_id UUID, required_perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner BOOLEAN;
  v_granted BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR target_org_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT public.is_org_owner(target_org_id) INTO v_is_owner;
  IF v_is_owner THEN
    RETURN TRUE;
  END IF;

  IF NOT public.is_org_member(target_org_id) THEN
    RETURN FALSE;
  END IF;

  SELECT
    CASE
      WHEN required_perm = ANY(ura.custom_permissions_deny) THEN FALSE
      WHEN required_perm = ANY(ura.custom_permissions_grant) THEN TRUE
      ELSE EXISTS (
        SELECT 1
        FROM public.role_permissions rp
        WHERE rp.role_id = ura.role_id
          AND rp.permission_code = required_perm
      )
    END
  INTO v_granted
  FROM public.user_role_assignments ura
  WHERE ura.organization_id = target_org_id
    AND ura.user_id = auth.uid();

  RETURN COALESCE(v_granted, FALSE);
END;
$$;

-- Enable Row-Level Security on ALL 41 tables (33 operational + 8 RBAC/tenancy tables)
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE workshop_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_of_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_of_material_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_order_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE finished_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE finished_product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE finished_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Tenant & Permission-Scoped RLS Policies
CREATE POLICY org_member_select_organizations ON organizations FOR SELECT USING (public.is_org_member(id));
CREATE POLICY org_owner_modify_organizations ON organizations FOR ALL USING (public.is_org_owner(id)) WITH CHECK (public.is_org_owner(id));

CREATE POLICY org_member_select_profiles ON profiles FOR SELECT USING (public.is_org_member(organization_id));
CREATE POLICY org_manage_profiles ON profiles FOR ALL USING (public.has_atelier_permission(organization_id, 'employees.manage')) WITH CHECK (public.has_atelier_permission(organization_id, 'employees.manage'));

CREATE POLICY org_member_select_memberships ON memberships FOR SELECT USING (public.is_org_member(organization_id));
CREATE POLICY org_manage_memberships ON memberships FOR ALL USING (public.has_atelier_permission(organization_id, 'employees.manage')) WITH CHECK (public.has_atelier_permission(organization_id, 'employees.manage'));

CREATE POLICY org_member_select_roles ON roles FOR SELECT USING (public.is_org_member(organization_id));
CREATE POLICY org_owner_manage_roles ON roles FOR ALL USING (public.is_org_owner(organization_id)) WITH CHECK (public.is_org_owner(organization_id));

CREATE POLICY authenticated_select_permissions ON permissions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY authenticated_select_role_permissions ON role_permissions FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY org_member_select_role_assignments ON user_role_assignments FOR SELECT USING (public.is_org_member(organization_id));
CREATE POLICY org_manage_role_assignments ON user_role_assignments FOR ALL USING (public.has_atelier_permission(organization_id, 'employees.manage')) WITH CHECK (public.has_atelier_permission(organization_id, 'employees.manage'));

CREATE POLICY org_select_audit_logs ON audit_logs FOR SELECT USING (public.has_atelier_permission(organization_id, 'reports.view') OR public.is_org_owner(organization_id));
CREATE POLICY org_insert_audit_logs ON audit_logs FOR INSERT WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY rls_workshop_settings_select ON workshop_settings FOR SELECT USING (public.has_atelier_permission(organization_id, 'dashboard.view'));
CREATE POLICY rls_workshop_settings_modify ON workshop_settings FOR ALL USING (public.has_atelier_permission(organization_id, 'settings.manage')) WITH CHECK (public.has_atelier_permission(organization_id, 'settings.manage'));

CREATE POLICY rls_categories_select ON categories FOR SELECT USING (public.has_atelier_permission(organization_id, 'dashboard.view'));
CREATE POLICY rls_categories_modify ON categories FOR ALL USING (public.has_atelier_permission(organization_id, 'inventory.adjust') OR public.has_atelier_permission(organization_id, 'models.create')) WITH CHECK (public.has_atelier_permission(organization_id, 'inventory.adjust') OR public.has_atelier_permission(organization_id, 'models.create'));

CREATE POLICY rls_suppliers_select ON suppliers FOR SELECT USING (public.has_atelier_permission(organization_id, 'purchases.view'));
CREATE POLICY rls_suppliers_modify ON suppliers FOR ALL USING (public.has_atelier_permission(organization_id, 'purchases.create')) WITH CHECK (public.has_atelier_permission(organization_id, 'purchases.create'));

CREATE POLICY rls_materials_select ON materials FOR SELECT USING (public.has_atelier_permission(organization_id, 'inventory.view'));
CREATE POLICY rls_materials_modify ON materials FOR ALL USING (public.has_atelier_permission(organization_id, 'inventory.adjust')) WITH CHECK (public.has_atelier_permission(organization_id, 'inventory.adjust'));

CREATE POLICY rls_material_images_select ON material_images FOR SELECT USING (public.has_atelier_permission(organization_id, 'inventory.view'));
CREATE POLICY rls_material_images_modify ON material_images FOR ALL USING (public.has_atelier_permission(organization_id, 'inventory.adjust')) WITH CHECK (public.has_atelier_permission(organization_id, 'inventory.adjust'));

CREATE POLICY rls_material_movements_select ON material_stock_movements FOR SELECT USING (public.has_atelier_permission(organization_id, 'inventory.view'));
CREATE POLICY rls_material_movements_insert ON material_stock_movements FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'inventory.adjust') OR public.has_atelier_permission(organization_id, 'purchases.create') OR public.has_atelier_permission(organization_id, 'production.update'));

CREATE POLICY rls_purchases_select ON purchases FOR SELECT USING (public.has_atelier_permission(organization_id, 'purchases.view'));
CREATE POLICY rls_purchases_modify ON purchases FOR ALL USING (public.has_atelier_permission(organization_id, 'purchases.create')) WITH CHECK (public.has_atelier_permission(organization_id, 'purchases.create'));

CREATE POLICY rls_purchase_items_select ON purchase_items FOR SELECT USING (public.has_atelier_permission(organization_id, 'purchases.view'));
CREATE POLICY rls_purchase_items_modify ON purchase_items FOR ALL USING (public.has_atelier_permission(organization_id, 'purchases.create')) WITH CHECK (public.has_atelier_permission(organization_id, 'purchases.create'));

CREATE POLICY rls_supplier_payments_select ON supplier_payments FOR SELECT USING (public.has_atelier_permission(organization_id, 'purchases.view') OR public.has_atelier_permission(organization_id, 'finance.view'));
CREATE POLICY rls_supplier_payments_insert ON supplier_payments FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'purchases.create'));

CREATE POLICY rls_models_select ON models FOR SELECT USING (public.has_atelier_permission(organization_id, 'models.view'));
CREATE POLICY rls_models_insert ON models FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'models.create'));
CREATE POLICY rls_models_update ON models FOR UPDATE USING (public.has_atelier_permission(organization_id, 'models.edit') OR public.has_atelier_permission(organization_id, 'models.delete')) WITH CHECK (public.has_atelier_permission(organization_id, 'models.edit') OR public.has_atelier_permission(organization_id, 'models.delete'));

CREATE POLICY rls_model_images_select ON model_images FOR SELECT USING (public.has_atelier_permission(organization_id, 'models.view'));
CREATE POLICY rls_model_images_modify ON model_images FOR ALL USING (public.has_atelier_permission(organization_id, 'models.create') OR public.has_atelier_permission(organization_id, 'models.edit')) WITH CHECK (public.has_atelier_permission(organization_id, 'models.create') OR public.has_atelier_permission(organization_id, 'models.edit'));

CREATE POLICY rls_model_variants_select ON model_variants FOR SELECT USING (public.has_atelier_permission(organization_id, 'models.view'));
CREATE POLICY rls_model_variants_modify ON model_variants FOR ALL USING (public.has_atelier_permission(organization_id, 'models.create') OR public.has_atelier_permission(organization_id, 'models.edit')) WITH CHECK (public.has_atelier_permission(organization_id, 'models.create') OR public.has_atelier_permission(organization_id, 'models.edit'));

CREATE POLICY rls_bom_select ON bill_of_materials FOR SELECT USING (public.has_atelier_permission(organization_id, 'models.view') OR public.has_atelier_permission(organization_id, 'production.view'));
CREATE POLICY rls_bom_modify ON bill_of_materials FOR ALL USING (public.has_atelier_permission(organization_id, 'models.create') OR public.has_atelier_permission(organization_id, 'models.edit')) WITH CHECK (public.has_atelier_permission(organization_id, 'models.create') OR public.has_atelier_permission(organization_id, 'models.edit'));

CREATE POLICY rls_bom_items_select ON bill_of_material_items FOR SELECT USING (public.has_atelier_permission(organization_id, 'models.view') OR public.has_atelier_permission(organization_id, 'production.view'));
CREATE POLICY rls_bom_items_modify ON bill_of_material_items FOR ALL USING (public.has_atelier_permission(organization_id, 'models.create') OR public.has_atelier_permission(organization_id, 'models.edit')) WITH CHECK (public.has_atelier_permission(organization_id, 'models.create') OR public.has_atelier_permission(organization_id, 'models.edit'));

CREATE POLICY rls_production_stages_select ON production_stages FOR SELECT USING (public.has_atelier_permission(organization_id, 'production.view'));
CREATE POLICY rls_production_stages_modify ON production_stages FOR ALL USING (public.has_atelier_permission(organization_id, 'settings.manage')) WITH CHECK (public.has_atelier_permission(organization_id, 'settings.manage'));

CREATE POLICY rls_production_orders_select ON production_orders FOR SELECT USING (public.has_atelier_permission(organization_id, 'production.view'));
CREATE POLICY rls_production_orders_insert ON production_orders FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'production.create'));
CREATE POLICY rls_production_orders_update ON production_orders FOR UPDATE USING (public.has_atelier_permission(organization_id, 'production.update') OR public.has_atelier_permission(organization_id, 'production.assign')) WITH CHECK (public.has_atelier_permission(organization_id, 'production.update') OR public.has_atelier_permission(organization_id, 'production.assign'));

CREATE POLICY rls_production_order_stages_select ON production_order_stages FOR SELECT USING (public.has_atelier_permission(organization_id, 'production.view'));
CREATE POLICY rls_production_order_stages_modify ON production_order_stages FOR ALL USING (public.has_atelier_permission(organization_id, 'production.update')) WITH CHECK (public.has_atelier_permission(organization_id, 'production.update'));

CREATE POLICY rls_production_consumptions_select ON production_consumptions FOR SELECT USING (public.has_atelier_permission(organization_id, 'production.view'));
CREATE POLICY rls_production_consumptions_modify ON production_consumptions FOR ALL USING (public.has_atelier_permission(organization_id, 'production.update')) WITH CHECK (public.has_atelier_permission(organization_id, 'production.update'));

CREATE POLICY rls_quality_checks_select ON quality_checks FOR SELECT USING (public.has_atelier_permission(organization_id, 'production.view'));
CREATE POLICY rls_quality_checks_modify ON quality_checks FOR ALL USING (public.has_atelier_permission(organization_id, 'production.update')) WITH CHECK (public.has_atelier_permission(organization_id, 'production.update'));

CREATE POLICY rls_finished_products_select ON finished_products FOR SELECT USING (public.has_atelier_permission(organization_id, 'models.view') OR public.has_atelier_permission(organization_id, 'sales.view'));
CREATE POLICY rls_finished_products_modify ON finished_products FOR ALL USING (public.has_atelier_permission(organization_id, 'production.update') OR public.has_atelier_permission(organization_id, 'sales.create')) WITH CHECK (public.has_atelier_permission(organization_id, 'production.update') OR public.has_atelier_permission(organization_id, 'sales.create'));

CREATE POLICY rls_finished_product_images_select ON finished_product_images FOR SELECT USING (public.has_atelier_permission(organization_id, 'models.view') OR public.has_atelier_permission(organization_id, 'sales.view'));
CREATE POLICY rls_finished_product_images_modify ON finished_product_images FOR ALL USING (public.has_atelier_permission(organization_id, 'production.update')) WITH CHECK (public.has_atelier_permission(organization_id, 'production.update'));

CREATE POLICY rls_finished_movements_select ON finished_stock_movements FOR SELECT USING (public.has_atelier_permission(organization_id, 'production.view') OR public.has_atelier_permission(organization_id, 'sales.view'));
CREATE POLICY rls_finished_movements_insert ON finished_stock_movements FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'production.update') OR public.has_atelier_permission(organization_id, 'sales.create') OR public.has_atelier_permission(organization_id, 'sales.cancel'));

CREATE POLICY rls_customers_select ON customers FOR SELECT USING (public.has_atelier_permission(organization_id, 'customers.view'));
CREATE POLICY rls_customers_insert ON customers FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'customers.create'));
CREATE POLICY rls_customers_update ON customers FOR UPDATE USING (public.has_atelier_permission(organization_id, 'customers.edit') OR public.has_atelier_permission(organization_id, 'sales.create')) WITH CHECK (public.has_atelier_permission(organization_id, 'customers.edit') OR public.has_atelier_permission(organization_id, 'sales.create'));

CREATE POLICY rls_sales_select ON sales FOR SELECT USING (public.has_atelier_permission(organization_id, 'sales.view'));
CREATE POLICY rls_sales_insert ON sales FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'sales.create'));
CREATE POLICY rls_sales_update ON sales FOR UPDATE USING (public.has_atelier_permission(organization_id, 'sales.edit') OR public.has_atelier_permission(organization_id, 'sales.cancel')) WITH CHECK (public.has_atelier_permission(organization_id, 'sales.edit') OR public.has_atelier_permission(organization_id, 'sales.cancel'));

CREATE POLICY rls_sale_items_select ON sale_items FOR SELECT USING (public.has_atelier_permission(organization_id, 'sales.view'));
CREATE POLICY rls_sale_items_insert ON sale_items FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'sales.create'));

CREATE POLICY rls_invoices_select ON invoices FOR SELECT USING (public.has_atelier_permission(organization_id, 'invoices.view'));
CREATE POLICY rls_invoices_insert ON invoices FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'invoices.create') OR public.has_atelier_permission(organization_id, 'sales.create'));
CREATE POLICY rls_invoices_update ON invoices FOR UPDATE USING (public.has_atelier_permission(organization_id, 'invoices.create') OR public.has_atelier_permission(organization_id, 'sales.cancel')) WITH CHECK (public.has_atelier_permission(organization_id, 'invoices.create') OR public.has_atelier_permission(organization_id, 'sales.cancel'));

CREATE POLICY rls_invoice_items_select ON invoice_items FOR SELECT USING (public.has_atelier_permission(organization_id, 'invoices.view'));
CREATE POLICY rls_invoice_items_insert ON invoice_items FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'invoices.create') OR public.has_atelier_permission(organization_id, 'sales.create'));

CREATE POLICY rls_payments_select ON payments FOR SELECT USING (public.has_atelier_permission(organization_id, 'invoices.view') OR public.has_atelier_permission(organization_id, 'finance.view'));
CREATE POLICY rls_payments_insert ON payments FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'invoices.create') OR public.has_atelier_permission(organization_id, 'sales.create'));

CREATE POLICY rls_refunds_select ON refunds FOR SELECT USING (public.has_atelier_permission(organization_id, 'invoices.view') OR public.has_atelier_permission(organization_id, 'finance.view'));
CREATE POLICY rls_refunds_insert ON refunds FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'sales.cancel'));

CREATE POLICY rls_expenses_select ON expenses FOR SELECT USING (public.has_atelier_permission(organization_id, 'finance.view') OR public.has_atelier_permission(organization_id, 'reports.view'));
CREATE POLICY rls_expenses_insert ON expenses FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'finance.create_expense'));

CREATE POLICY rls_cash_movements_select ON cash_movements FOR SELECT USING (public.has_atelier_permission(organization_id, 'finance.view') OR public.has_atelier_permission(organization_id, 'reports.view'));
CREATE POLICY rls_cash_movements_insert ON cash_movements FOR INSERT WITH CHECK (public.has_atelier_permission(organization_id, 'finance.create_expense') OR public.has_atelier_permission(organization_id, 'invoices.create') OR public.has_atelier_permission(organization_id, 'sales.create') OR public.has_atelier_permission(organization_id, 'sales.cancel') OR public.has_atelier_permission(organization_id, 'purchases.create'));

CREATE POLICY rls_attachments_select ON attachments FOR SELECT USING (public.is_org_member(organization_id));
CREATE POLICY rls_attachments_insert ON attachments FOR INSERT WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY rls_activity_logs_select ON activity_logs FOR SELECT USING (public.has_atelier_permission(organization_id, 'reports.view') OR public.is_org_owner(organization_id));
CREATE POLICY rls_activity_logs_insert ON activity_logs FOR INSERT WITH CHECK (public.is_org_member(organization_id));
