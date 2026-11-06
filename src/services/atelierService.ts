import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";

export type PaymentStatus =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

export interface PaymentStatusInput {
  totalAmount: number;
  paidAmount: number;
  refundedAmount: number;
  dueDateIso: string;
  nowIso?: string;
  documentStatus?: "DRAFT" | "ISSUED" | "CANCELLED";
}

export function roundMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function roundQty(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

/**
 * Returns the current date in Africa/Algiers timezone formatted as YYYY-MM-DD.
 * Eliminates hardcoded date constants across reporting and overdue checks.
 */
export function getAlgiersCurrentDateIso(referenceDate?: Date): string {
  const d = referenceDate || new Date();
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Algiers",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (y && m && day) return `${y}-${m}-${day}`;
  } catch {
    // Fallback to UTC ISO slice
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Pure deterministic calculation of Invoice Payment Status.
 * Derived strictly from payment records, refund records, and due date.
 */
export function calculateInvoicePaymentStatus(input: PaymentStatusInput): {
  paymentStatus: PaymentStatus;
  netPaidAmount: number;
  remainingBalance: number;
} {
  const total = roundMoney(input.totalAmount);
  const paid = roundMoney(input.paidAmount);
  const refunded = roundMoney(input.refundedAmount);
  const netPaid = roundMoney(Math.max(0, paid - refunded));
  const remaining = roundMoney(Math.max(0, total - netPaid));
  const todayIso = input.nowIso ? input.nowIso.slice(0, 10) : getAlgiersCurrentDateIso();
  const dueIso = (input.dueDateIso || todayIso).slice(0, 10);

  if (refunded > 0 && netPaid === 0 && paid > 0) {
    return { paymentStatus: "REFUNDED", netPaidAmount: netPaid, remainingBalance: 0 };
  }
  if (refunded > 0 && netPaid > 0) {
    return { paymentStatus: "PARTIALLY_REFUNDED", netPaidAmount: netPaid, remainingBalance: remaining };
  }
  if (remaining === 0 && total > 0) {
    return { paymentStatus: "PAID", netPaidAmount: netPaid, remainingBalance: 0 };
  }
  if (remaining > 0 && todayIso > dueIso) {
    return { paymentStatus: "OVERDUE", netPaidAmount: netPaid, remainingBalance: remaining };
  }
  if (netPaid > 0 && remaining > 0) {
    return { paymentStatus: "PARTIALLY_PAID", netPaidAmount: netPaid, remainingBalance: remaining };
  }
  return { paymentStatus: "UNPAID", netPaidAmount: netPaid, remainingBalance: remaining };
}

/**
 * Moving Weighted-Average Cost (Coût Moyen Pondéré - CMP) calculation on purchase receipt.
 */
export function calculateMovingWeightedAverageCost(
  currentOnHandQty: number,
  currentAvgCost: number,
  receivedQty: number,
  receivedUnitCost: number
): number {
  if (receivedQty <= 0) return roundMoney(currentAvgCost);
  const safeCurrentQty = Math.max(0, currentOnHandQty);
  const totalValue = safeCurrentQty * currentAvgCost + receivedQty * receivedUnitCost;
  const newTotalQty = safeCurrentQty + receivedQty;
  if (newTotalQty <= 0) return roundMoney(receivedUnitCost);
  return roundMoney(totalValue / newTotalQty);
}

async function computeNextCashBalance(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  direction: "IN" | "OUT",
  amount: number
): Promise<number> {
  const [latest] = await tx
    .select()
    .from(schema.cashMovements)
    .orderBy(desc(schema.cashMovements.createdAt))
    .limit(1);
  const currentBalance = latest ? Number(latest.balanceAfter) : 0;
  const delta = direction === "IN" ? amount : -amount;
  return roundMoney(currentBalance + delta);
}

/**
 * PostgreSQL Transactional Mutations via Drizzle ORM
 * Every financial and stock ledger operation enforces idempotencyKey uniqueness
 * and uses row-level locking (.for("update")) inside a single database transaction.
 */
export const AtelierPostgresRepository = {
  async adjustMaterialStock(input: {
    idempotencyKey: string;
    materialId: string;
    direction: "IN" | "OUT";
    quantity: number;
    reason: string;
  }) {
    return await db.transaction(async (tx) => {
      const [existingMovement] = await tx
        .select()
        .from(schema.materialStockMovements)
        .where(eq(schema.materialStockMovements.idempotencyKey, input.idempotencyKey))
        .limit(1);

      if (existingMovement) {
        return {
          materialId: existingMovement.materialId,
          onHandQty: Number(existingMovement.balanceAfterOnHand),
          availableQty: Number(existingMovement.balanceAfterAvailable),
          movement: existingMovement,
          idempotentReplay: true,
        };
      }

      const [mat] = await tx
        .select()
        .from(schema.materials)
        .where(eq(schema.materials.id, input.materialId))
        .for("update");
      if (!mat) throw new Error("Material not found");

      const onHand = Number(mat.onHandQty);
      const reserved = Number(mat.reservedQty);
      const available = roundQty(onHand - reserved);
      const qty = roundQty(input.quantity);

      if (input.direction === "OUT" && qty > available) {
        throw new Error(`Insufficient available stock (${available} ${mat.unit})`);
      }

      const nextOnHand = input.direction === "IN" ? roundQty(onHand + qty) : roundQty(onHand - qty);
      const nextAvailable = roundQty(Math.max(0, nextOnHand - reserved));
      const unitCost = Number(mat.averageCost);

      await tx
        .update(schema.materials)
        .set({
          onHandQty: String(nextOnHand),
          availableQty: String(nextAvailable),
          updatedAt: new Date(),
        })
        .where(eq(schema.materials.id, mat.id));

      const [movement] = await tx
        .insert(schema.materialStockMovements)
        .values({
          idempotencyKey: input.idempotencyKey,
          materialId: mat.id,
          movementType: input.direction === "IN" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
          direction: input.direction,
          quantity: String(qty),
          unitCost: String(unitCost),
          totalCost: String(roundMoney(qty * unitCost)),
          balanceAfterOnHand: String(nextOnHand),
          balanceAfterAvailable: String(nextAvailable),
          referenceType: "MANUAL_ADJUSTMENT",
          referenceId: `ADJ-${Date.now()}`,
          reason: input.reason,
        })
        .returning();

      return { materialId: mat.id, onHandQty: nextOnHand, availableQty: nextAvailable, movement };
    });
  },

  async updateMaterialDetails(input: {
    id: string;
    sku: string;
    nameAr: string;
    nameFr: string;
    categoryId: string;
    supplierId?: string | null;
    unit: string;
    minStockThreshold: number;
    storageLocation?: string;
    primaryImageUrl?: string;
    description?: string;
  }) {
    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.materials)
        .set({
          sku: input.sku,
          nameAr: input.nameAr,
          nameFr: input.nameFr,
          categoryId: input.categoryId,
          supplierId: input.supplierId || null,
          unit: input.unit,
          minStockThreshold: String(roundQty(input.minStockThreshold)),
          storageLocation: input.storageLocation || "Rayon A1",
          primaryImageUrl: input.primaryImageUrl,
          description: input.description,
          updatedAt: new Date(),
        })
        .where(eq(schema.materials.id, input.id))
        .returning();
      if (!updated) throw new Error("Material not found for update");
      return updated;
    });
  },

  async receivePurchaseTransaction(input: {
    idempotencyKey: string;
    supplierId: string;
    shippingCost?: number;
    discountAmount?: number;
    paidAmount: number;
    paymentMethod: string;
    notes?: string;
    items: Array<{
      materialId: string;
      orderedQty: number;
      receivedQty: number;
      unitPrice: number;
      discountAmount?: number;
    }>;
  }) {
    return await db.transaction(async (tx) => {
      const [existingPurchase] = await tx
        .select()
        .from(schema.purchases)
        .where(eq(schema.purchases.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existingPurchase) {
        return existingPurchase;
      }

      let subtotal = 0;
      for (const item of input.items) {
        subtotal += roundMoney(item.receivedQty * item.unitPrice - (item.discountAmount || 0));
      }
      const shipping = roundMoney(input.shippingCost || 0);
      const orderDiscount = roundMoney(input.discountAmount || 0);
      const totalAmount = roundMoney(Math.max(0, subtotal + shipping - orderDiscount));
      const paid = roundMoney(Math.min(totalAmount, input.paidAmount));
      const remaining = roundMoney(totalAmount - paid);
      const purchaseNumber = `ACH-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;

      const [purchase] = await tx
        .insert(schema.purchases)
        .values({
          idempotencyKey: input.idempotencyKey,
          purchaseNumber,
          supplierId: input.supplierId,
          purchaseDate: new Date(),
          receiptStatus: "RECEIVED",
          paymentStatus: remaining === 0 ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "UNPAID",
          subtotal: String(subtotal),
          shippingCost: String(shipping),
          discountAmount: String(orderDiscount),
          totalAmount: String(totalAmount),
          paidAmount: String(paid),
          remainingAmount: String(remaining),
          notes: input.notes || "",
          receivedAt: new Date(),
        })
        .returning();

      for (const item of input.items) {
        const [mat] = await tx
          .select()
          .from(schema.materials)
          .where(eq(schema.materials.id, item.materialId))
          .for("update");
        if (!mat) throw new Error(`Material ${item.materialId} not found`);

        const oldOnHand = Number(mat.onHandQty);
        const oldReserved = Number(mat.reservedQty);
        const oldAvg = Number(mat.averageCost);
        const recQty = roundQty(item.receivedQty);
        const newAvg = calculateMovingWeightedAverageCost(oldOnHand, oldAvg, recQty, item.unitPrice);
        const nextOnHand = roundQty(oldOnHand + recQty);
        const nextAvail = roundQty(Math.max(0, nextOnHand - oldReserved));

        await tx.insert(schema.purchaseItems).values({
          purchaseId: purchase.id,
          materialId: mat.id,
          orderedQty: String(item.orderedQty),
          receivedQty: String(recQty),
          unitPrice: String(item.unitPrice),
          discountAmount: String(item.discountAmount || 0),
          lineTotal: String(roundMoney(recQty * item.unitPrice - (item.discountAmount || 0))),
        });

        await tx
          .update(schema.materials)
          .set({
            onHandQty: String(nextOnHand),
            availableQty: String(nextAvail),
            averageCost: String(newAvg),
            lastPurchaseCost: String(item.unitPrice),
            updatedAt: new Date(),
          })
          .where(eq(schema.materials.id, mat.id));

        await tx.insert(schema.materialStockMovements).values({
          idempotencyKey: `${input.idempotencyKey}-mat-${mat.id}`,
          materialId: mat.id,
          movementType: "PURCHASE_RECEIPT",
          direction: "IN",
          quantity: String(recQty),
          unitCost: String(item.unitPrice),
          totalCost: String(roundMoney(recQty * item.unitPrice)),
          balanceAfterOnHand: String(nextOnHand),
          balanceAfterAvailable: String(nextAvail),
          referenceType: "PURCHASE",
          referenceId: purchaseNumber,
          reason: `Purchase receipt ${purchaseNumber} (New CMP: ${newAvg} DZD)`,
        });
      }

      await tx
        .update(schema.suppliers)
        .set({
          totalPurchases: sql`${schema.suppliers.totalPurchases} + ${totalAmount}`,
          totalPaid: sql`${schema.suppliers.totalPaid} + ${paid}`,
          outstandingBalance: sql`${schema.suppliers.outstandingBalance} + ${remaining}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.suppliers.id, input.supplierId));

      if (paid > 0) {
        const nextCashBalance = await computeNextCashBalance(tx, "OUT", paid);
        await tx.insert(schema.cashMovements).values({
          idempotencyKey: `cash-pur-${input.idempotencyKey}`,
          movementReference: `TRES-${Date.now().toString().slice(-5)}`,
          direction: "OUT",
          category: "SUPPLIER_PAYMENT",
          amount: String(paid),
          paymentMethod: input.paymentMethod,
          balanceAfter: String(nextCashBalance),
          referenceType: "PURCHASE",
          referenceId: purchase.id,
          description: `Règlement achat ${purchaseNumber}`,
          movementDate: new Date(),
        });
      }

      return purchase;
    });
  },

  async recordSupplierPaymentTransaction(input: {
    idempotencyKey: string;
    supplierId: string;
    purchaseId?: string | null;
    amount: number;
    paymentMethod: string;
    notes?: string;
  }) {
    return await db.transaction(async (tx) => {
      const [existingPayment] = await tx
        .select()
        .from(schema.supplierPayments)
        .where(eq(schema.supplierPayments.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existingPayment) {
        return existingPayment;
      }

      const [supplier] = await tx
        .select()
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, input.supplierId))
        .for("update");
      if (!supplier) throw new Error("Supplier not found");

      const amt = roundMoney(input.amount);
      const paymentReference = `PAIE-FOUR-${Date.now().toString().slice(-5)}`;
      const [payment] = await tx
        .insert(schema.supplierPayments)
        .values({
          idempotencyKey: input.idempotencyKey,
          paymentReference,
          supplierId: input.supplierId,
          purchaseId: input.purchaseId || null,
          amount: String(amt),
          paymentMethod: input.paymentMethod,
          paymentDate: new Date(),
          notes: input.notes || "",
        })
        .returning();

      await tx
        .update(schema.suppliers)
        .set({
          totalPaid: sql`${schema.suppliers.totalPaid} + ${amt}`,
          outstandingBalance: sql`GREATEST(0, ${schema.suppliers.outstandingBalance} - ${amt})`,
          updatedAt: new Date(),
        })
        .where(eq(schema.suppliers.id, input.supplierId));

      const nextCashBalance = await computeNextCashBalance(tx, "OUT", amt);
      await tx.insert(schema.cashMovements).values({
        idempotencyKey: `cash-${input.idempotencyKey}`,
        movementReference: `TRES-${Date.now().toString().slice(-5)}`,
        direction: "OUT",
        category: "SUPPLIER_PAYMENT",
        amount: String(amt),
        paymentMethod: input.paymentMethod,
        balanceAfter: String(nextCashBalance),
        referenceType: "SUPPLIER_PAYMENT",
        referenceId: payment.id,
        description: input.notes || "Règlement fournisseur / دفعة لمورد",
        movementDate: new Date(),
      });

      return payment;
    });
  },

  async createModelWithBomTransaction(input: {
    code: string;
    nameAr: string;
    nameFr: string;
    categoryId: string;
    description?: string;
    availableColors?: string[];
    availableSizes?: string[];
    expectedProductionHours?: number;
    estimatedLaborCost?: number;
    defaultSellingPrice: number;
    primaryImageUrl?: string;
    bomItems: Array<{
      materialId: string;
      quantityPerUnit: number;
      wastagePercent?: number;
      stageNote?: string;
    }>;
  }) {
    return await db.transaction(async (tx) => {
      const [model] = await tx
        .insert(schema.models)
        .values({
          code: input.code,
          nameAr: input.nameAr,
          nameFr: input.nameFr,
          categoryId: input.categoryId,
          description: input.description,
          availableColors: input.availableColors || ["Noir"],
          availableSizes: input.availableSizes || ["S", "M", "L"],
          expectedProductionHours: String(roundMoney(input.expectedProductionHours || 8)),
          estimatedLaborCost: String(roundMoney(input.estimatedLaborCost || 3000)),
          defaultSellingPrice: String(roundMoney(input.defaultSellingPrice)),
          primaryImageUrl: input.primaryImageUrl,
        })
        .returning();

      const [bom] = await tx
        .insert(schema.billOfMaterials)
        .values({
          modelId: model.id,
          version: 1,
          batchSize: 1,
          isCurrent: true,
        })
        .returning();

      for (const item of input.bomItems) {
        await tx.insert(schema.billOfMaterialItems).values({
          bomId: bom.id,
          materialId: item.materialId,
          quantityPerUnit: String(roundQty(item.quantityPerUnit)),
          wastagePercent: String(roundMoney(item.wastagePercent || 0)),
          stageNote: item.stageNote,
        });
      }

      return { model, bomId: bom.id };
    });
  },

  async createProductionOrderTransaction(input: {
    idempotencyKey: string;
    modelId: string;
    color: string;
    size: string;
    requestedQty: number;
    plannedStartDate: string;
    expectedCompletionDate: string;
    assignedNotes?: string;
  }) {
    return await db.transaction(async (tx) => {
      const [existingOrder] = await tx
        .select()
        .from(schema.productionOrders)
        .where(eq(schema.productionOrders.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existingOrder) {
        return existingOrder;
      }

      const [bom] = await tx
        .select()
        .from(schema.billOfMaterials)
        .where(eq(schema.billOfMaterials.modelId, input.modelId))
        .limit(1);
      if (!bom) throw new Error("Active Bill of Materials (BOM) not found for model");

      const orderNumber = `OF-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
      const [order] = await tx
        .insert(schema.productionOrders)
        .values({
          idempotencyKey: input.idempotencyKey,
          orderNumber,
          modelId: input.modelId,
          bomId: bom.id,
          color: input.color,
          size: input.size,
          requestedQty: input.requestedQty,
          status: "CUTTING",
          currentStageCode: "CUTTING",
          plannedStartDate: new Date(input.plannedStartDate),
          expectedCompletionDate: new Date(input.expectedCompletionDate),
          assignedNotes: input.assignedNotes || "",
        })
        .returning();
      return order;
    });
  },

  async completeProductionOrderTransaction(input: {
    idempotencyKey: string;
    productionOrderId: string;
    producedQty: number;
    acceptedQty: number;
    rejectedQty: number;
    wastePercent?: number;
    directLaborCost?: number;
    qcNotes?: string;
  }) {
    return await db.transaction(async (tx) => {
      const [existingMovement] = await tx
        .select()
        .from(schema.finishedStockMovements)
        .where(eq(schema.finishedStockMovements.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existingMovement) {
        return {
          orderId: input.productionOrderId,
          finishedMovement: existingMovement,
          idempotentReplay: true,
        };
      }

      const [order] = await tx
        .select()
        .from(schema.productionOrders)
        .where(eq(schema.productionOrders.id, input.productionOrderId))
        .for("update");
      if (!order) throw new Error("Production order not found");
      if (order.status === "COMPLETED" || order.stockCompleted) {
        throw new Error("Production order has already been completed");
      }
      if (input.acceptedQty + input.rejectedQty !== input.producedQty) {
        throw new Error("Accepted + Rejected units must equal Produced units");
      }

      const [model] = await tx
        .select()
        .from(schema.models)
        .where(eq(schema.models.id, order.modelId))
        .limit(1);
      if (!model) throw new Error("Associated model not found");

      const laborCost = roundMoney(
        input.directLaborCost !== undefined ? input.directLaborCost : Number(order.directLaborCost || model.estimatedLaborCost || 0)
      );
      const actualTotalCost = roundMoney(Number(order.actualMaterialCost || order.estimatedMaterialCost || 0) + laborCost);
      const actualUnitCost =
        input.acceptedQty > 0 ? roundMoney(actualTotalCost / input.acceptedQty) : 0;

      await tx
        .update(schema.productionOrders)
        .set({
          producedQty: input.producedQty,
          acceptedQty: input.acceptedQty,
          rejectedQty: input.rejectedQty,
          status: "COMPLETED",
          currentStageCode: "COMPLETED",
          stockCompleted: true,
          directLaborCost: String(laborCost),
          actualTotalCost: String(actualTotalCost),
          actualUnitCost: String(actualUnitCost),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.productionOrders.id, order.id));

      await tx.insert(schema.qualityChecks).values({
        productionOrderId: order.id,
        inspectedQty: input.producedQty,
        acceptedQty: input.acceptedQty,
        rejectedQty: input.rejectedQty,
        result: input.rejectedQty === 0 ? "ACCEPTED" : "NEEDS_REWORK",
        notes: input.qcNotes || "",
      });

      const [fp] = await tx
        .insert(schema.finishedProducts)
        .values({
          sku: `PF-${order.orderNumber}-${order.size}`,
          modelId: order.modelId,
          categoryId: model.categoryId,
          nameAr: `${model.nameAr} (${order.orderNumber})`,
          nameFr: `${model.nameFr} (${order.orderNumber})`,
          color: order.color,
          size: order.size,
          onHandQty: input.acceptedQty,
          availableQty: input.acceptedQty,
          unitProductionCost: String(actualUnitCost),
          sellingPrice: String(model.defaultSellingPrice),
        })
        .returning();

      await tx.insert(schema.finishedStockMovements).values({
        idempotencyKey: input.idempotencyKey,
        finishedProductId: fp.id,
        movementType: "PRODUCTION_COMPLETION",
        direction: "IN",
        quantity: input.acceptedQty,
        unitCost: String(actualUnitCost),
        balanceAfter: input.acceptedQty,
        referenceType: "PRODUCTION_ORDER",
        referenceId: order.orderNumber,
        reason: `Production order ${order.orderNumber} completed`,
      });

      return { orderId: order.id, finishedProduct: fp, unitProductionCost: actualUnitCost };
    });
  },

  async completeSaleCheckoutTransaction(input: {
    idempotencyKey: string;
    customerId: string;
    items: Array<{
      finishedProductId: string;
      quantity: number;
      lineDiscount?: number;
    }>;
    orderDiscountAmount?: number;
    amountReceived?: number;
    paymentMethod: string;
    dueDate: string;
    notes?: string;
  }) {
    return await db.transaction(async (tx) => {
      const [existingSale] = await tx
        .select()
        .from(schema.sales)
        .where(eq(schema.sales.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existingSale) {
        const [existingInvoice] = await tx
          .select()
          .from(schema.invoices)
          .where(eq(schema.invoices.saleId, existingSale.id))
          .limit(1);
        return { sale: existingSale, invoice: existingInvoice, idempotentReplay: true };
      }

      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, input.customerId))
        .for("update");
      if (!customer) throw new Error("Customer not found");

      const [workshop] = await tx.select().from(schema.workshopSettings).limit(1);

      let subtotal = 0;
      let lineDiscountTotal = 0;
      let totalCogs = 0;
      const lineSnapshots: Array<{
        fp: typeof schema.finishedProducts.$inferSelect;
        qty: number;
        unitPrice: number;
        unitCost: number;
        lineDiscount: number;
        lineTotal: number;
      }> = [];

      for (const item of input.items) {
        const [fp] = await tx
          .select()
          .from(schema.finishedProducts)
          .where(eq(schema.finishedProducts.id, item.finishedProductId))
          .for("update");
        if (!fp) throw new Error(`Finished product ${item.finishedProductId} not found`);
        if (fp.availableQty < item.quantity) {
          throw new Error(`Insufficient finished stock for ${fp.sku} (available: ${fp.availableQty})`);
        }
        const unitPrice = roundMoney(Number(fp.sellingPrice));
        const unitCost = roundMoney(Number(fp.unitProductionCost));
        const lineDiscount = roundMoney(item.lineDiscount || 0);
        const lineTotal = roundMoney(Math.max(0, item.quantity * unitPrice - lineDiscount));
        subtotal = roundMoney(subtotal + item.quantity * unitPrice);
        lineDiscountTotal = roundMoney(lineDiscountTotal + lineDiscount);
        totalCogs = roundMoney(totalCogs + item.quantity * unitCost);
        lineSnapshots.push({
          fp,
          qty: item.quantity,
          unitPrice,
          unitCost,
          lineDiscount,
          lineTotal,
        });
      }

      const orderDiscount = roundMoney(input.orderDiscountAmount || 0);
      const discountTotal = roundMoney(lineDiscountTotal + orderDiscount);
      const taxable = Math.max(0, subtotal - discountTotal);
      const taxRate = workshop?.taxEnabled ? Number(workshop.defaultTaxRate || 0) : 0;
      const taxAmount = roundMoney(taxable * (taxRate / 100));
      const totalAmount = roundMoney(taxable + taxAmount);
      const paidAmount = roundMoney(Math.min(totalAmount, input.amountReceived || 0));
      const statusCalc = calculateInvoicePaymentStatus({
        totalAmount,
        paidAmount,
        refundedAmount: 0,
        dueDateIso: input.dueDate || getAlgiersCurrentDateIso(),
      });

      const saleNumber = `VTE-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
      const invoiceNumber = `FAC-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;

      const [sale] = await tx
        .insert(schema.sales)
        .values({
          idempotencyKey: input.idempotencyKey,
          saleNumber,
          customerId: customer.id,
          saleDate: new Date(),
          status: "CONFIRMED",
          subtotal: String(subtotal),
          lineDiscountTotal: String(lineDiscountTotal),
          orderDiscountAmount: String(orderDiscount),
          taxAmount: String(taxAmount),
          totalAmount: String(totalAmount),
          totalCogs: String(totalCogs),
          notes: input.notes || "",
        })
        .returning();

      const [invoice] = await tx
        .insert(schema.invoices)
        .values({
          invoiceNumber,
          saleId: sale.id,
          customerId: customer.id,
          documentStatus: "ISSUED",
          paymentStatus: statusCalc.paymentStatus,
          issueDate: new Date(),
          dueDate: input.dueDate ? new Date(input.dueDate) : new Date(),
          workshopSnapshotJson: workshop || { nameFr: "Maison AFAF EL ASSLI" },
          customerSnapshotJson: {
            id: customer.id,
            fullName: customer.fullName,
            phone: customer.phone,
            wilaya: customer.wilaya,
          },
          subtotal: String(subtotal),
          discountTotal: String(discountTotal),
          taxAmount: String(taxAmount),
          totalAmount: String(totalAmount),
          paidAmount: String(paidAmount),
          refundedAmount: "0.00",
          netPaidAmount: String(statusCalc.netPaidAmount),
          remainingBalance: String(statusCalc.remainingBalance),
          notes: input.notes || "",
        })
        .returning();

      for (let idx = 0; idx < lineSnapshots.length; idx++) {
        const snap = lineSnapshots[idx];
        const nextOnHand = snap.fp.onHandQty - snap.qty;
        const nextAvail = Math.max(0, snap.fp.availableQty - snap.qty);

        await tx
          .update(schema.finishedProducts)
          .set({
            onHandQty: nextOnHand,
            availableQty: nextAvail,
            status: nextAvail === 0 ? "OUT_OF_STOCK" : nextAvail <= snap.fp.minStockThreshold ? "LOW_STOCK" : "AVAILABLE",
            updatedAt: new Date(),
          })
          .where(eq(schema.finishedProducts.id, snap.fp.id));

        await tx.insert(schema.saleItems).values({
          saleId: sale.id,
          finishedProductId: snap.fp.id,
          productSkuSnapshot: snap.fp.sku,
          productNameArSnapshot: snap.fp.nameAr,
          productNameFrSnapshot: snap.fp.nameFr,
          colorSnapshot: snap.fp.color,
          sizeSnapshot: snap.fp.size,
          quantity: snap.qty,
          unitPrice: String(snap.unitPrice),
          unitCostSnapshot: String(snap.unitCost),
          lineDiscount: String(snap.lineDiscount),
          lineTotal: String(snap.lineTotal),
        });

        await tx.insert(schema.invoiceItems).values({
          invoiceId: invoice.id,
          lineNumber: idx + 1,
          skuSnapshot: snap.fp.sku,
          descriptionArSnapshot: snap.fp.nameAr,
          descriptionFrSnapshot: snap.fp.nameFr,
          colorSnapshot: snap.fp.color,
          sizeSnapshot: snap.fp.size,
          quantity: snap.qty,
          unitPrice: String(snap.unitPrice),
          lineDiscount: String(snap.lineDiscount),
          lineTotal: String(snap.lineTotal),
        });

        await tx.insert(schema.finishedStockMovements).values({
          idempotencyKey: `${input.idempotencyKey}-sale-fp-${snap.fp.id}-${idx}`,
          finishedProductId: snap.fp.id,
          movementType: "SALE_DISPATCH",
          direction: "OUT",
          quantity: snap.qty,
          unitCost: String(snap.unitCost),
          balanceAfter: nextOnHand,
          referenceType: "SALE",
          referenceId: saleNumber,
          reason: `POS sale ${saleNumber}`,
        });
      }

      if (paidAmount > 0) {
        const paymentReference = `REG-${Date.now().toString().slice(-5)}`;
        const [payment] = await tx
          .insert(schema.payments)
          .values({
            idempotencyKey: `pay-${input.idempotencyKey}`,
            paymentReference,
            invoiceId: invoice.id,
            customerId: customer.id,
            amount: String(paidAmount),
            paymentMethod: input.paymentMethod || "CASH",
            paymentDate: new Date(),
          })
          .returning();

        const nextCashBalance = await computeNextCashBalance(tx, "IN", paidAmount);
        await tx.insert(schema.cashMovements).values({
          idempotencyKey: `cash-sale-${input.idempotencyKey}`,
          movementReference: `TRES-${Date.now().toString().slice(-5)}`,
          direction: "IN",
          category: "CUSTOMER_PAYMENT",
          amount: String(paidAmount),
          paymentMethod: input.paymentMethod || "CASH",
          balanceAfter: String(nextCashBalance),
          referenceType: "PAYMENT",
          referenceId: payment.id,
          description: `Encaissement vente ${saleNumber}`,
          movementDate: new Date(),
        });
      }

      await tx
        .update(schema.customers)
        .set({
          totalPurchases: sql`${schema.customers.totalPurchases} + ${totalAmount}`,
          totalPaid: sql`${schema.customers.totalPaid} + ${paidAmount}`,
          outstandingBalance: sql`${schema.customers.outstandingBalance} + ${statusCalc.remainingBalance}`,
          lastPurchaseAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.customers.id, customer.id));

      return { sale, invoice };
    });
  },

  async recordCustomerPaymentTransaction(input: {
    idempotencyKey: string;
    invoiceId: string;
    amount: number;
    paymentMethod: string;
    paymentDate?: string;
    externalRef?: string;
    notes?: string;
  }) {
    return await db.transaction(async (tx) => {
      const [existingPayment] = await tx
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existingPayment) {
        const [inv] = await tx
          .select()
          .from(schema.invoices)
          .where(eq(schema.invoices.id, existingPayment.invoiceId))
          .limit(1);
        return { payment: existingPayment, invoice: inv, idempotentReplay: true };
      }

      const [inv] = await tx
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, input.invoiceId))
        .for("update");
      if (!inv) throw new Error("Invoice not found");

      const amt = roundMoney(input.amount);
      if (amt > Number(inv.remainingBalance)) {
        throw new Error("Payment amount cannot exceed invoice remaining balance");
      }

      const nextPaid = roundMoney(Number(inv.paidAmount) + amt);
      const statusCalc = calculateInvoicePaymentStatus({
        totalAmount: Number(inv.totalAmount),
        paidAmount: nextPaid,
        refundedAmount: Number(inv.refundedAmount),
        dueDateIso: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : getAlgiersCurrentDateIso(),
      });

      const [payment] = await tx
        .insert(schema.payments)
        .values({
          idempotencyKey: input.idempotencyKey,
          paymentReference: `REG-${Date.now().toString().slice(-5)}`,
          invoiceId: inv.id,
          customerId: inv.customerId,
          amount: String(amt),
          paymentMethod: input.paymentMethod,
          paymentDate: input.paymentDate ? new Date(input.paymentDate) : new Date(),
          externalRef: input.externalRef || "",
          notes: input.notes || "",
        })
        .returning();

      const [updatedInvoice] = await tx
        .update(schema.invoices)
        .set({
          paidAmount: String(nextPaid),
          netPaidAmount: String(statusCalc.netPaidAmount),
          remainingBalance: String(statusCalc.remainingBalance),
          paymentStatus: statusCalc.paymentStatus,
          updatedAt: new Date(),
        })
        .where(eq(schema.invoices.id, inv.id))
        .returning();

      await tx
        .update(schema.customers)
        .set({
          totalPaid: sql`${schema.customers.totalPaid} + ${amt}`,
          outstandingBalance: sql`GREATEST(0, ${schema.customers.outstandingBalance} - ${amt})`,
          updatedAt: new Date(),
        })
        .where(eq(schema.customers.id, inv.customerId));

      const nextCashBalance = await computeNextCashBalance(tx, "IN", amt);
      await tx.insert(schema.cashMovements).values({
        idempotencyKey: `cash-pay-${input.idempotencyKey}`,
        movementReference: `TRES-${Date.now().toString().slice(-5)}`,
        direction: "IN",
        category: "CUSTOMER_PAYMENT",
        amount: String(amt),
        paymentMethod: input.paymentMethod,
        balanceAfter: String(nextCashBalance),
        referenceType: "PAYMENT",
        referenceId: payment.id,
        description: input.notes || `Règlement facture ${inv.invoiceNumber}`,
        movementDate: new Date(),
      });

      return { payment, invoice: updatedInvoice };
    });
  },

  async processRefundTransaction(input: {
    idempotencyKey: string;
    invoiceId: string;
    finishedProductId?: string;
    returnedQuantity?: number;
    returnCondition?: "RESTOCK" | "QUARANTINE_DAMAGED" | "NO_PHYSICAL_RETURN";
    amount: number;
    refundMethod: string;
    reason: string;
    refundDate?: string;
  }) {
    return await db.transaction(async (tx) => {
      const [existingRefund] = await tx
        .select()
        .from(schema.refunds)
        .where(eq(schema.refunds.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existingRefund) {
        const [inv] = await tx
          .select()
          .from(schema.invoices)
          .where(eq(schema.invoices.id, existingRefund.invoiceId))
          .limit(1);
        return { refund: existingRefund, invoice: inv, idempotentReplay: true };
      }

      const [inv] = await tx
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, input.invoiceId))
        .for("update");
      if (!inv) throw new Error("Invoice not found");

      const amt = roundMoney(input.amount);
      const nextRefunded = roundMoney(Number(inv.refundedAmount) + amt);
      if (nextRefunded > Number(inv.paidAmount)) {
        throw new Error("Refund amount cannot exceed total paid amount");
      }

      const statusCalc = calculateInvoicePaymentStatus({
        totalAmount: Number(inv.totalAmount),
        paidAmount: Number(inv.paidAmount),
        refundedAmount: nextRefunded,
        dueDateIso: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : getAlgiersCurrentDateIso(),
      });

      const refundReference = `AVO-${Date.now().toString().slice(-5)}`;
      const returnedQty = input.returnedQuantity || 0;
      const returnCondition = input.returnCondition || "RESTOCK";

      const [refund] = await tx
        .insert(schema.refunds)
        .values({
          idempotencyKey: input.idempotencyKey,
          refundReference,
          saleId: inv.saleId,
          invoiceId: inv.id,
          customerId: inv.customerId,
          finishedProductId: input.finishedProductId || null,
          returnedQuantity: returnedQty,
          returnCondition,
          amount: String(amt),
          refundMethod: input.refundMethod,
          reason: input.reason,
          refundDate: input.refundDate ? new Date(input.refundDate) : new Date(),
        })
        .returning();

      if (returnCondition === "RESTOCK" && returnedQty > 0 && input.finishedProductId) {
        const [fp] = await tx
          .select()
          .from(schema.finishedProducts)
          .where(eq(schema.finishedProducts.id, input.finishedProductId))
          .for("update");
        if (fp) {
          const nextOnHand = fp.onHandQty + returnedQty;
          const nextAvail = fp.availableQty + returnedQty;
          await tx
            .update(schema.finishedProducts)
            .set({
              onHandQty: nextOnHand,
              availableQty: nextAvail,
              status: "AVAILABLE",
              updatedAt: new Date(),
            })
            .where(eq(schema.finishedProducts.id, fp.id));

          await tx.insert(schema.finishedStockMovements).values({
            idempotencyKey: `restock-${input.idempotencyKey}`,
            finishedProductId: fp.id,
            movementType: "CUSTOMER_RETURN_RESTOCK",
            direction: "IN",
            quantity: returnedQty,
            unitCost: String(fp.unitProductionCost),
            balanceAfter: nextOnHand,
            referenceType: "REFUND",
            referenceId: refundReference,
            reason: input.reason,
          });
        }
      }

      const [updatedInvoice] = await tx
        .update(schema.invoices)
        .set({
          refundedAmount: String(nextRefunded),
          netPaidAmount: String(statusCalc.netPaidAmount),
          remainingBalance: String(statusCalc.remainingBalance),
          paymentStatus: statusCalc.paymentStatus,
          updatedAt: new Date(),
        })
        .where(eq(schema.invoices.id, inv.id))
        .returning();

      const nextCashBalance = await computeNextCashBalance(tx, "OUT", amt);
      await tx.insert(schema.cashMovements).values({
        idempotencyKey: `cash-ref-${input.idempotencyKey}`,
        movementReference: `TRES-${Date.now().toString().slice(-5)}`,
        direction: "OUT",
        category: "CUSTOMER_REFUND",
        amount: String(amt),
        paymentMethod: input.refundMethod,
        balanceAfter: String(nextCashBalance),
        referenceType: "REFUND",
        referenceId: refund.id,
        description: `Remboursement client ${refundReference}: ${input.reason}`,
        movementDate: new Date(),
      });

      return { refund, invoice: updatedInvoice };
    });
  },
};
