import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { evaluateAnyUserPermission, evaluateUserPermission, PermissionCode } from "@/lib/rbac";
import { enforceRateLimit } from "@/lib/rateLimit";
import {
  calculateInvoicePaymentStatus,
  calculateMovingWeightedAverageCost,
  getAlgiersCurrentDateIso,
  AtelierPostgresRepository,
  roundMoney,
  roundQty,
} from "@/services/atelierService";
import {
  PaymentStatusCalculationSchema,
  CmpCalculationSchema,
  MaterialCreateSchema,
  MaterialUpdateSchema,
  StockAdjustmentSchema,
  SupplierCreateSchema,
  PurchaseOrderSchema,
  SupplierPaymentSchema,
  ModelCreateSchema,
  ModelUpdateSchema,
  EntityIdSchema,
  ProductionOrderCreateSchema,
  ProductionOrderAssignSchema,
  ProductionCompletionSchema,
  FinishedProductCreateSchema,
  SaleCheckoutSchema,
  SaleUpdateSchema,
  PaymentCreateSchema,
  RefundCreateSchema,
  CustomerCreateSchema,
  CustomerUpdateSchema,
  ExpenseCreateSchema,
  WorkshopSettingsUpdateSchema,
} from "@/lib/validators";

/**
 * Complete server-side mapping of all Atelier OS actions to the 27-permission RBAC model.
 * Any action not present in this map is rejected fail-closed.
 */
export const dynamic = "force-dynamic";
const ACTION_REQUIRED_PERMISSION: Record<string, PermissionCode> = {
  CALCULATE_PAYMENT_STATUS: "invoices.view",
  CALCULATE_CMP: "inventory.view",
  ADD_MATERIAL: "inventory.adjust",
  CREATE_MATERIAL: "inventory.adjust",
  UPDATE_MATERIAL: "inventory.adjust",
  ADJUST_MATERIAL_STOCK: "inventory.adjust",
  CREATE_SUPPLIER: "purchases.create",
  CREATE_AND_RECEIVE_PURCHASE: "purchases.create",
  RECORD_SUPPLIER_PAYMENT: "purchases.create",
  CREATE_MODEL: "models.create",
  CREATE_MODEL_WITH_BOM: "models.create",
  UPDATE_MODEL: "models.edit",
  DELETE_MODEL: "models.delete",
  CREATE_PRODUCTION_ORDER: "production.create",
  ASSIGN_PRODUCTION_ORDER: "production.assign",
  COMPLETE_PRODUCTION_ORDER: "production.update",
  CREATE_FINISHED_PRODUCT: "production.update",
  COMPLETE_POS_SALE: "sales.create",
  CREATE_POS_SALE: "sales.create",
  UPDATE_SALE: "sales.edit",
  CANCEL_SALE: "sales.cancel",
  RECORD_PAYMENT: "invoices.create",
  RECORD_REFUND: "sales.cancel",
  PROCESS_REFUND: "sales.cancel",
  CREATE_CUSTOMER: "customers.create",
  UPDATE_CUSTOMER: "customers.edit",
  CREATE_EXPENSE: "finance.create_expense",
  RECORD_EXPENSE: "finance.create_expense",
  UPDATE_WORKSHOP_SETTINGS: "settings.manage",
};

export async function GET(request: NextRequest) {
  const rateLimitResponse = enforceRateLimit(request, {
    namespace: "api:atelier:get",
    maxRequests: 120,
    windowMs: 60 * 1000,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const auth = await requirePermission(request, "dashboard.view");
  if (!auth.ok) {
    return auth.response;
  }
  const user = auth.user;

  try {
    const canViewInventory = evaluateUserPermission(user, "inventory.view");
    const canViewPurchases = evaluateUserPermission(user, "purchases.view");
    const canViewModels = evaluateUserPermission(user, "models.view");
    const canViewProduction = evaluateUserPermission(user, "production.view");
    const canViewCustomers = evaluateUserPermission(user, "customers.view");
    const canViewSales = evaluateUserPermission(user, "sales.view");
    const canViewInvoices = evaluateUserPermission(user, "invoices.view");
    const canViewFinance = evaluateAnyUserPermission(user, ["finance.view", "reports.view"]);

    const [settings] = await db.select().from(schema.workshopSettings).limit(1);
    const categories = canViewInventory ? await db.select().from(schema.categories) : [];
    const suppliers = canViewPurchases ? await db.select().from(schema.suppliers) : [];
    const materials = canViewInventory ? await db.select().from(schema.materials) : [];
    const materialMovements = canViewInventory
      ? await db
          .select()
          .from(schema.materialStockMovements)
          .orderBy(desc(schema.materialStockMovements.createdAt))
      : [];
    const purchases = canViewPurchases
      ? await db.select().from(schema.purchases).orderBy(desc(schema.purchases.createdAt))
      : [];
    const models = canViewModels ? await db.select().from(schema.models) : [];
    const productionOrders = canViewProduction
      ? await db
          .select()
          .from(schema.productionOrders)
          .orderBy(desc(schema.productionOrders.createdAt))
      : [];
    const finishedProducts =
      canViewModels || canViewSales ? await db.select().from(schema.finishedProducts) : [];
    const finishedMovements = canViewProduction
      ? await db
          .select()
          .from(schema.finishedStockMovements)
          .orderBy(desc(schema.finishedStockMovements.createdAt))
      : [];
    const customers = canViewCustomers ? await db.select().from(schema.customers) : [];
    const sales = canViewSales
      ? await db.select().from(schema.sales).orderBy(desc(schema.sales.createdAt))
      : [];
    const invoices = canViewInvoices
      ? await db.select().from(schema.invoices).orderBy(desc(schema.invoices.createdAt))
      : [];
    const payments = canViewInvoices
      ? await db.select().from(schema.payments).orderBy(desc(schema.payments.createdAt))
      : [];
    const refunds = canViewInvoices
      ? await db.select().from(schema.refunds).orderBy(desc(schema.refunds.createdAt))
      : [];
    const expenses = canViewFinance
      ? await db.select().from(schema.expenses).orderBy(desc(schema.expenses.createdAt))
      : [];
    const cashMovements = canViewFinance
      ? await db
          .select()
          .from(schema.cashMovements)
          .orderBy(desc(schema.cashMovements.createdAt))
      : [];

    return NextResponse.json({
      ok: true,
      system: "ATELIER OS — Maison AFAF EL ASSLI",
      version: "1.1.0",
      currentAlgiersDate: getAlgiersCurrentDateIso(),
      data: {
        settings,
        categories,
        suppliers,
        materials,
        materialMovements,
        purchases,
        models,
        productionOrders,
        finishedProducts,
        finishedMovements,
        customers,
        sales,
        invoices,
        payments,
        refunds,
        expenses,
        cashMovements,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Failed to load workshop state" } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = enforceRateLimit(request, {
    namespace: "api:atelier:post",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    // Never trust client-supplied role or permission fields from the request body.
    const { action, payload } = body || {};
    const requiredPerm = ACTION_REQUIRED_PERMISSION[String(action)];

    if (!requiredPerm) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_ACTION", message: "Unsupported action requested" } },
        { status: 400 }
      );
    }

    const auth = await requirePermission(request, requiredPerm);
    if (!auth.ok) {
      return auth.response;
    }

    switch (action) {
      case "CALCULATE_PAYMENT_STATUS": {
        const parsed = PaymentStatusCalculationSchema.parse(payload);
        return NextResponse.json(calculateInvoicePaymentStatus(parsed));
      }
      case "CALCULATE_CMP": {
        const parsed = CmpCalculationSchema.parse(payload);
        return NextResponse.json({
          averageCost: calculateMovingWeightedAverageCost(
            parsed.currentOnHandQty,
            parsed.currentAvgCost,
            parsed.receivedQty,
            parsed.receivedUnitCost
          ),
        });
      }
      case "ADD_MATERIAL":
      case "CREATE_MATERIAL": {
        const parsed = MaterialCreateSchema.parse(payload);
        const result = await db.transaction(async (tx) => {
          const [mat] = await tx
            .insert(schema.materials)
            .values({
              sku: parsed.sku,
              nameAr: parsed.nameAr,
              nameFr: parsed.nameFr,
              categoryId: parsed.categoryId,
              supplierId: parsed.supplierId || null,
              color: parsed.color,
              unit: parsed.unit,
              onHandQty: String(roundQty(parsed.openingQty)),
              reservedQty: "0.000",
              availableQty: String(roundQty(parsed.openingQty)),
              minStockThreshold: String(roundQty(parsed.minStockThreshold)),
              averageCost: String(roundMoney(parsed.unitCost)),
              lastPurchaseCost: String(roundMoney(parsed.unitCost)),
              storageLocation: parsed.storageLocation,
              primaryImageUrl: parsed.primaryImageUrl,
              description: parsed.description,
            })
            .returning();

          if (parsed.openingQty > 0) {
            await tx.insert(schema.materialStockMovements).values({
              idempotencyKey: `open-${mat.id}`,
              materialId: mat.id,
              movementType: "OPENING_BALANCE",
              direction: "IN",
              quantity: String(roundQty(parsed.openingQty)),
              unitCost: String(roundMoney(parsed.unitCost)),
              totalCost: String(roundMoney(parsed.openingQty * parsed.unitCost)),
              balanceAfterOnHand: String(roundQty(parsed.openingQty)),
              balanceAfterAvailable: String(roundQty(parsed.openingQty)),
              referenceType: "INITIAL_SEED",
              referenceId: mat.sku,
              reason: "Opening balance at material creation",
            });
          }
          return mat;
        });
        return NextResponse.json({ status: "CREATED", result }, { status: 201 });
      }
      case "UPDATE_MATERIAL": {
        const parsed = MaterialUpdateSchema.parse(payload);
        const result = await AtelierPostgresRepository.updateMaterialDetails(parsed);
        return NextResponse.json({ status: "UPDATED", result });
      }
      case "ADJUST_MATERIAL_STOCK": {
        const parsed = StockAdjustmentSchema.parse(payload);
        const result = await AtelierPostgresRepository.adjustMaterialStock(parsed);
        return NextResponse.json({ status: "COMMITTED", result });
      }
      case "CREATE_SUPPLIER": {
        const parsed = SupplierCreateSchema.parse(payload);
        const supplier = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(schema.suppliers)
            .values({
              code: `FOUR-${Date.now().toString().slice(-4)}`,
              name: parsed.name,
              contactPerson: parsed.contactPerson,
              phone: parsed.phone,
              email: parsed.email || null,
              city: parsed.city,
              address: parsed.address,
              notes: parsed.notes,
            })
            .returning();
          return created;
        });
        return NextResponse.json({ status: "CREATED", result: supplier }, { status: 201 });
      }
      case "CREATE_AND_RECEIVE_PURCHASE": {
        const parsed = PurchaseOrderSchema.parse(payload);
        const result = await AtelierPostgresRepository.receivePurchaseTransaction(parsed);
        return NextResponse.json({ status: "COMMITTED", result }, { status: 201 });
      }
      case "CREATE_CUSTOMER": {
        const parsed = CustomerCreateSchema.parse(payload);
        const customer = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(schema.customers)
            .values({
              code: `CLI-${Date.now().toString().slice(-4)}`,
              fullName: parsed.fullName,
              phone: parsed.phone,
              wilaya: parsed.wilaya,
              address: parsed.address,
              measurementsJson: parsed.measurements || {},
              notes: parsed.notes,
            })
            .returning();
          return created;
        });
        return NextResponse.json({ status: "CREATED", result: customer }, { status: 201 });
      }
      case "UPDATE_CUSTOMER": {
        const parsed = CustomerUpdateSchema.parse(payload);
        const updated = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(schema.customers)
            .set({
              ...(parsed.fullName ? { fullName: parsed.fullName } : {}),
              ...(parsed.phone ? { phone: parsed.phone } : {}),
              ...(parsed.wilaya ? { wilaya: parsed.wilaya } : {}),
              ...(parsed.address !== undefined ? { address: parsed.address } : {}),
              ...(parsed.measurements ? { measurementsJson: parsed.measurements } : {}),
              ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
              updatedAt: new Date(),
            })
            .where(eq(schema.customers.id, parsed.id))
            .returning();
          return row;
        });
        return NextResponse.json({ status: "UPDATED", result: updated });
      }
      case "CREATE_EXPENSE":
      case "RECORD_EXPENSE": {
        const parsed = ExpenseCreateSchema.parse(payload);
        const expense = await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(schema.expenses)
            .where(eq(schema.expenses.idempotencyKey, parsed.idempotencyKey))
            .limit(1);
          if (existing) return existing;

          const amt = roundMoney(parsed.amount);
          const expenseNumber = `DEP-${Date.now().toString().slice(-5)}`;
          const [created] = await tx
            .insert(schema.expenses)
            .values({
              idempotencyKey: parsed.idempotencyKey,
              expenseNumber,
              titleAr: parsed.titleAr,
              titleFr: parsed.titleFr,
              categoryId: parsed.categoryId,
              amount: String(amt),
              paymentMethod: parsed.paymentMethod,
              beneficiary: parsed.beneficiary,
              expenseDate: parsed.expenseDate ? new Date(parsed.expenseDate) : new Date(),
              description: parsed.description,
              attachmentUrl: parsed.attachmentUrl,
            })
            .returning();

          const [latestCash] = await tx
            .select()
            .from(schema.cashMovements)
            .orderBy(desc(schema.cashMovements.createdAt))
            .limit(1);
          const nextBalance = roundMoney((latestCash ? Number(latestCash.balanceAfter) : 0) - amt);

          await tx.insert(schema.cashMovements).values({
            idempotencyKey: `cash-exp-${parsed.idempotencyKey}`,
            movementReference: `TRES-${Date.now().toString().slice(-5)}`,
            direction: "OUT",
            category: "OPERATING_EXPENSE",
            amount: String(amt),
            paymentMethod: parsed.paymentMethod,
            balanceAfter: String(nextBalance),
            referenceType: "EXPENSE",
            referenceId: created.id,
            description: `${parsed.titleFr} / ${parsed.titleAr}`,
            movementDate: new Date(),
          });

          return created;
        });
        return NextResponse.json({ status: "CREATED", result: expense }, { status: 201 });
      }
      case "RECORD_SUPPLIER_PAYMENT": {
        const parsed = SupplierPaymentSchema.parse(payload);
        const result = await AtelierPostgresRepository.recordSupplierPaymentTransaction(parsed);
        return NextResponse.json({ status: "COMMITTED", result }, { status: 201 });
      }
      case "CREATE_MODEL":
      case "CREATE_MODEL_WITH_BOM": {
        const parsed = ModelCreateSchema.parse(payload);
        const result = await AtelierPostgresRepository.createModelWithBomTransaction(parsed);
        return NextResponse.json({ status: "CREATED", result }, { status: 201 });
      }
      case "UPDATE_MODEL": {
        const parsed = ModelUpdateSchema.parse(payload);
        const updated = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(schema.models)
            .set({
              ...(parsed.nameAr ? { nameAr: parsed.nameAr } : {}),
              ...(parsed.nameFr ? { nameFr: parsed.nameFr } : {}),
              ...(parsed.defaultSellingPrice !== undefined
                ? { defaultSellingPrice: String(roundMoney(parsed.defaultSellingPrice)) }
                : {}),
              ...(parsed.primaryImageUrl !== undefined
                ? { primaryImageUrl: parsed.primaryImageUrl }
                : {}),
              ...(parsed.description !== undefined ? { description: parsed.description } : {}),
              updatedAt: new Date(),
            })
            .where(eq(schema.models.id, parsed.id))
            .returning();
          return row;
        });
        return NextResponse.json({ status: "UPDATED", result: updated });
      }
      case "DELETE_MODEL": {
        const parsed = EntityIdSchema.parse(payload);
        const archived = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(schema.models)
            .set({ status: "ARCHIVED", updatedAt: new Date() })
            .where(eq(schema.models.id, parsed.id))
            .returning();
          return row;
        });
        return NextResponse.json({ status: "ARCHIVED", result: archived });
      }
      case "CREATE_PRODUCTION_ORDER": {
        const parsed = ProductionOrderCreateSchema.parse(payload);
        const result = await AtelierPostgresRepository.createProductionOrderTransaction(parsed);
        return NextResponse.json({ status: "CREATED", result }, { status: 201 });
      }
      case "ASSIGN_PRODUCTION_ORDER": {
        const parsed = ProductionOrderAssignSchema.parse(payload);
        const updated = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(schema.productionOrders)
            .set({ assignedNotes: parsed.assignedNotes, updatedAt: new Date() })
            .where(eq(schema.productionOrders.id, parsed.orderId))
            .returning();
          return row;
        });
        return NextResponse.json({ status: "UPDATED", result: updated });
      }
      case "COMPLETE_PRODUCTION_ORDER": {
        const parsed = ProductionCompletionSchema.parse(payload);
        const result = await AtelierPostgresRepository.completeProductionOrderTransaction(parsed);
        return NextResponse.json({ status: "COMMITTED", result });
      }
      case "CREATE_FINISHED_PRODUCT": {
        const parsed = FinishedProductCreateSchema.parse(payload);
        const fp = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(schema.finishedProducts)
            .values({
              sku: parsed.sku,
              barcode: parsed.barcode,
              modelId: parsed.modelId,
              categoryId: parsed.categoryId,
              nameAr: parsed.nameAr,
              nameFr: parsed.nameFr,
              color: parsed.color,
              size: parsed.size,
              onHandQty: parsed.qty,
              availableQty: parsed.qty,
              unitProductionCost: String(roundMoney(parsed.unitCost)),
              sellingPrice: String(roundMoney(parsed.sellingPrice)),
              primaryImageUrl: parsed.primaryImageUrl,
            })
            .returning();

          if (parsed.qty > 0) {
            await tx.insert(schema.finishedStockMovements).values({
              idempotencyKey: `open-fp-${created.id}`,
              finishedProductId: created.id,
              movementType: "OPENING_STOCK",
              direction: "IN",
              quantity: parsed.qty,
              unitCost: String(roundMoney(parsed.unitCost)),
              balanceAfter: parsed.qty,
              referenceType: "MANUAL_ADJUSTMENT",
              referenceId: created.sku,
              reason: "Opening finished stock creation",
            });
          }
          return created;
        });
        return NextResponse.json({ status: "CREATED", result: fp }, { status: 201 });
      }
      case "COMPLETE_POS_SALE":
      case "CREATE_POS_SALE": {
        const parsed = SaleCheckoutSchema.parse(payload);
        const result = await AtelierPostgresRepository.completeSaleCheckoutTransaction(parsed);
        return NextResponse.json({ status: "COMMITTED", result }, { status: 201 });
      }
      case "UPDATE_SALE": {
        const parsed = SaleUpdateSchema.parse(payload);
        const updated = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(schema.sales)
            .set({ notes: parsed.notes, updatedAt: new Date() })
            .where(eq(schema.sales.id, parsed.id))
            .returning();
          return row;
        });
        return NextResponse.json({ status: "UPDATED", result: updated });
      }
      case "RECORD_PAYMENT": {
        const parsed = PaymentCreateSchema.parse(payload);
        const result = await AtelierPostgresRepository.recordCustomerPaymentTransaction(parsed);
        return NextResponse.json({ status: "COMMITTED", result }, { status: 201 });
      }
      case "CANCEL_SALE":
      case "RECORD_REFUND":
      case "PROCESS_REFUND": {
        const parsed = RefundCreateSchema.parse(payload);
        const result = await AtelierPostgresRepository.processRefundTransaction(parsed);
        return NextResponse.json({ status: "COMMITTED", result }, { status: 201 });
      }
      case "UPDATE_WORKSHOP_SETTINGS": {
        const parsed = WorkshopSettingsUpdateSchema.parse(payload);
        const updated = await db.transaction(async (tx) => {
          const [existing] = await tx.select().from(schema.workshopSettings).limit(1);
          if (!existing) return null;
          const [row] = await tx
            .update(schema.workshopSettings)
            .set({
              ...(parsed.workshopNameAr ? { workshopNameAr: parsed.workshopNameAr } : {}),
              ...(parsed.workshopNameFr ? { workshopNameFr: parsed.workshopNameFr } : {}),
              ...(parsed.phone ? { phone: parsed.phone } : {}),
              ...(parsed.addressAr ? { addressAr: parsed.addressAr } : {}),
              ...(parsed.addressFr ? { addressFr: parsed.addressFr } : {}),
              updatedAt: new Date(),
            })
            .where(eq(schema.workshopSettings.id, existing.id))
            .returning();
          return row;
        });
        if (!updated) {
          return NextResponse.json(
            { ok: false, error: { code: "NOT_FOUND", message: "Workshop settings not initialized" } },
            { status: 404 }
          );
        }
        return NextResponse.json({ status: "UPDATED", result: updated });
      }
      default: {
        return NextResponse.json(
          { ok: false, error: { code: "INVALID_ACTION", message: "Unsupported action requested" } },
          { status: 400 }
        );
      }
    }
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request payload format or constraints",
          },
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "TRANSACTION_FAILED",
          message: "Operation could not be completed due to a business rule or constraint violation",
        },
      },
      { status: 422 }
    );
  }
}
