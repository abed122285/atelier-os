# BACKUP_AND_RECOVERY.md — ATELIER OS Backup, Storage & Disaster Recovery Strategy

**Project**: ATELIER OS (`Maison AFAF EL ASSLI — دار عفاف الأصلي للأزياء الراقية`)
**Supabase Project ID**: `<your-supabase-project-ref>` (`eu-central-1`, PostgreSQL `17.11`)

---

## 1. Critical Architecture Rule: Database vs. Supabase Storage Backups

> **Important**: Supabase PostgreSQL database backups (`pg_dump` and Point-in-Time Recovery) back up relational tables (`public.models`, `public.model_images`, `public.attachments`, `public.invoices`), **NOT** the underlying binary files stored inside Supabase Storage buckets (`atelier-models`, `atelier-production`, `atelier-documents`). Both tiers must be backed up together.

---

## 2. Tier 1 — PostgreSQL Database Backup & Versioned Migrations

### A. Versioned Schema & Policy Migrations
All schema definitions, constraints, indexes, RBAC functions (`public.has_atelier_permission`), and RLS policies are version-controlled under `supabase/migrations/` and `drizzle/`:
1. `0001_atelier_os_enterprise_rbac_and_core_schema.sql` — 36 normalized tables & primary/foreign keys.
2. `0002_atelier_os_rls_policies_storage_and_seed.sql` — RBAC functions, RLS policies, private Storage buckets, and initial seed.
3. `0003_optimize_rls_policies_and_fk_indexes.sql` — Granular `INSERT`/`UPDATE`/`DELETE` policies & 58 covering FK indexes.
4. `0004_seed_initial_owner_and_employee_accounts.sql` — Initial Owner & Employee accounts.

### B. Logical Database Export (`pg_dump`)
Run logical exports of both schema and data before any major release:
```bash
# Full logical backup (roles, schema, and data)
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --file="backups/atelier_os_db_$(date +%Y%m%d_%H%M%S).dump"
```

---

## 3. Tier 2 — Supabase Storage Object Backup (`atelier-models`, `atelier-production`, `atelier-documents`)

Because binary photographs (front, back, side, detail model shots) and PDF attachments reside in private Supabase Storage buckets:
1. **Metadata Reconciliation**: Every Storage object path is recorded in `public.model_images` (`storage_bucket`, `storage_path`) and `public.attachments`.
2. **S3-Compatible Sync Backup**: Sync the private buckets to encrypted off-site storage using your configured Supabase S3 Storage endpoint (`https://<your-supabase-project-ref>.supabase.co/storage/v1/s3`):
```bash
aws s3 sync s3://atelier-models ./backups/storage/atelier-models --endpoint-url "https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/s3"
aws s3 sync s3://atelier-production ./backups/storage/atelier-production --endpoint-url "https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/s3"
aws s3 sync s3://atelier-documents ./backups/storage/atelier-documents --endpoint-url "https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/s3"
```

---

## 4. Recovery & Verification Procedure

1. **Staging / Branch Verification**: Never restore directly over production without verifying in a staging database or local PostgreSQL container first:
```bash
pg_restore --clean --if-exists --no-owner --dbname="$STAGING_DATABASE_URL" backups/atelier_os_db_latest.dump
python3 tests/security_audit.py
```
2. **Post-Restore Integrity Checks**:
   - Confirm all public tables have `rowsecurity = true`.
   - Confirm `public.permissions` contains all `27` granular permissions.
   - Verify trial balance between `public.invoices.paid_amount` and `public.payments.amount`.
