import { z } from "zod";

export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB strict server-side limit

export const PaymentMethodEnum = z.enum([
  "CASH",
  "BARIDIMOB",
  "CCP",
  "BANK_TRANSFER",
  "CIB",
  "EDAHABIA",
  "COD",
  "CUSTOM",
]);

export const PaymentStatusCalculationSchema = z.object({
  totalAmount: z.number().nonnegative(),
  paidAmount: z.number().nonnegative(),
  refundedAmount: z.number().nonnegative().default(0),
  dueDateIso: z.string().min(8).max(32),
  nowIso: z.string().optional(),
  documentStatus: z.enum(["DRAFT", "ISSUED", "CANCELLED"]).optional(),
});

export const CmpCalculationSchema = z.object({
  currentOnHandQty: z.number().nonnegative(),
  currentAvgCost: z.number().nonnegative(),
  receivedQty: z.number().positive(),
  receivedUnitCost: z.number().nonnegative(),
});

export const MaterialCreateSchema = z.object({
  sku: z.string().min(2).max(64),
  nameAr: z.string().min(2).max(160),
  nameFr: z.string().min(2).max(160),
  categoryId: z.string().min(1),
  supplierId: z.string().optional().nullable(),
  color: z.string().max(64).optional(),
  unit: z.enum(["m", "cm", "pcs", "kg", "g", "roll", "pkg", "custom"]),
  openingQty: z.number().nonnegative().default(0),
  minStockThreshold: z.number().nonnegative().default(5),
  unitCost: z.number().nonnegative().default(0),
  storageLocation: z.string().max(120).default("Rayon A1"),
  primaryImageUrl: z.string().optional(),
  description: z.string().optional(),
});

export const MaterialUpdateSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(2).max(64),
  nameAr: z.string().min(2).max(160),
  nameFr: z.string().min(2).max(160),
  categoryId: z.string().min(1),
  supplierId: z.string().optional().nullable(),
  unit: z.enum(["m", "cm", "pcs", "kg", "g", "roll", "pkg", "custom"]),
  minStockThreshold: z.number().nonnegative(),
  storageLocation: z.string().max(120).optional(),
  primaryImageUrl: z.string().optional(),
  description: z.string().optional(),
});

export const StockAdjustmentSchema = z.object({
  idempotencyKey: z.string().min(6).max(128),
  materialId: z.string().min(1),
  direction: z.enum(["IN", "OUT"]),
  quantity: z.number().positive(),
  reason: z.string().min(3, "Mandatory reason required for inventory adjustment"),
});

export const SupplierCreateSchema = z.object({
  name: z.string().min(2).max(160),
  contactPerson: z.string().optional(),
  phone: z.string().min(6).max(40),
  email: z.string().email().optional().or(z.literal("")),
  city: z.string().min(2).max(80).default("16 - Alger"),
  address: z.string().optional(),
  notes: z.string().optional(),
});

export const PurchaseOrderSchema = z.object({
  idempotencyKey: z.string().min(6).max(128),
  supplierId: z.string().min(1),
  purchaseDate: z.string().optional(),
  dueDate: z.string().optional(),
  shippingCost: z.number().nonnegative().default(0),
  discountAmount: z.number().nonnegative().default(0),
  paidAmount: z.number().nonnegative().default(0),
  paymentMethod: PaymentMethodEnum.default("CASH"),
  receiveImmediately: z.boolean().default(true),
  items: z
    .array(
      z.object({
        materialId: z.string().min(1),
        orderedQty: z.number().positive(),
        receivedQty: z.number().nonnegative(),
        unitPrice: z.number().nonnegative(),
        discountAmount: z.number().nonnegative().default(0),
      })
    )
    .min(1),
  notes: z.string().optional(),
});

export const SupplierPaymentSchema = z.object({
  idempotencyKey: z.string().min(6).max(128),
  supplierId: z.string().min(1),
  purchaseId: z.string().optional().nullable(),
  amount: z.number().positive(),
  paymentMethod: PaymentMethodEnum,
  notes: z.string().optional(),
});

export const ModelCreateSchema = z.object({
  code: z.string().min(2).max(48),
  nameAr: z.string().min(2).max(160),
  nameFr: z.string().min(2).max(160),
  categoryId: z.string().min(1),
  description: z.string().optional(),
  availableColors: z.array(z.string()).default(["Noir"]),
  availableSizes: z.array(z.string()).default(["S", "M", "L"]),
  expectedProductionHours: z.number().positive().default(8),
  estimatedLaborCost: z.number().nonnegative().default(3000),
  defaultSellingPrice: z.number().positive(),
  primaryImageUrl: z.string().optional(),
  bomItems: z
    .array(
      z.object({
        materialId: z.string().min(1),
        quantityPerUnit: z.number().positive(),
        wastagePercent: z.number().nonnegative().default(0),
        stageNote: z.string().optional(),
      })
    )
    .min(1),
});

export const ModelUpdateSchema = z.object({
  id: z.string().min(1),
  nameAr: z.string().min(2).max(160).optional(),
  nameFr: z.string().min(2).max(160).optional(),
  defaultSellingPrice: z.number().positive().optional(),
  primaryImageUrl: z.string().optional(),
  description: z.string().optional(),
});

export const EntityIdSchema = z.object({
  id: z.string().min(1),
});

export const ProductionOrderCreateSchema = z.object({
  idempotencyKey: z.string().min(6).max(128),
  modelId: z.string().min(1),
  color: z.string().min(1),
  size: z.string().min(1),
  requestedQty: z.number().int().positive(),
  plannedStartDate: z.string(),
  expectedCompletionDate: z.string(),
  assignedNotes: z.string().optional(),
});

export const ProductionOrderAssignSchema = z.object({
  orderId: z.string().min(1),
  assignedNotes: z.string().min(1).max(200),
});

export const ProductionCompletionSchema = z
  .object({
    idempotencyKey: z.string().min(6).max(128),
    productionOrderId: z.string().min(1),
    producedQty: z.number().int().positive(),
    acceptedQty: z.number().int().positive(),
    rejectedQty: z.number().int().nonnegative(),
    wastePercent: z.number().nonnegative().default(0),
    directLaborCost: z.number().nonnegative().default(0),
    qcNotes: z.string().optional(),
  })
  .refine((d) => d.acceptedQty + d.rejectedQty === d.producedQty, {
    message: "Accepted quantity + Rejected quantity must equal Total Produced quantity",
  });

export const FinishedProductCreateSchema = z.object({
  modelId: z.string().min(1),
  categoryId: z.string().min(1),
  sku: z.string().min(2).max(64),
  barcode: z.string().optional(),
  nameAr: z.string().min(2).max(160),
  nameFr: z.string().min(2).max(160),
  color: z.string().min(1),
  size: z.string().min(1),
  qty: z.number().int().nonnegative(),
  unitCost: z.number().nonnegative(),
  sellingPrice: z.number().positive(),
  primaryImageUrl: z.string().optional(),
});

export const SaleCheckoutSchema = z.object({
  idempotencyKey: z.string().min(6).max(128),
  customerId: z.string().min(1),
  items: z
    .array(
      z.object({
        finishedProductId: z.string().min(1),
        quantity: z.number().int().positive(),
        lineDiscount: z.number().nonnegative().default(0),
      })
    )
    .min(1),
  orderDiscountAmount: z.number().nonnegative().default(0),
  amountReceived: z.number().nonnegative().default(0),
  paymentMethod: PaymentMethodEnum,
  dueDate: z.string(),
  notes: z.string().optional(),
});

export const SaleUpdateSchema = z.object({
  id: z.string().min(1),
  notes: z.string().max(500),
});

export const PaymentCreateSchema = z.object({
  idempotencyKey: z.string().min(6).max(128),
  invoiceId: z.string().min(1),
  amount: z.number().positive(),
  paymentMethod: PaymentMethodEnum,
  paymentDate: z.string().optional(),
  externalRef: z.string().optional(),
  notes: z.string().optional(),
});

export const RefundCreateSchema = z.object({
  idempotencyKey: z.string().min(6).max(128),
  invoiceId: z.string().min(1),
  finishedProductId: z.string().optional(),
  returnedQuantity: z.number().int().nonnegative().default(0),
  returnCondition: z
    .enum(["RESTOCK", "QUARANTINE_DAMAGED", "NO_PHYSICAL_RETURN"])
    .default("RESTOCK"),
  amount: z.number().positive(),
  refundMethod: PaymentMethodEnum,
  reason: z.string().min(3),
  refundDate: z.string().optional(),
});

export const CustomerCreateSchema = z.object({
  fullName: z.string().min(2).max(160),
  phone: z.string().min(6).max(40),
  wilaya: z.string().default("16 - Alger"),
  address: z.string().optional(),
  measurements: z.record(z.string()).optional(),
  notes: z.string().optional(),
});

export const CustomerUpdateSchema = CustomerCreateSchema.partial().extend({
  id: z.string().min(1),
});

export const ExpenseCreateSchema = z.object({
  idempotencyKey: z.string().min(6).max(128),
  titleAr: z.string().min(2).max(160),
  titleFr: z.string().min(2).max(160),
  categoryId: z.string().min(1),
  amount: z.number().positive(),
  paymentMethod: PaymentMethodEnum,
  beneficiary: z.string().optional(),
  expenseDate: z.string().optional(),
  description: z.string().optional(),
  attachmentUrl: z.string().optional(),
});

export const WorkshopSettingsUpdateSchema = z.object({
  workshopNameAr: z.string().min(2).max(160).optional(),
  workshopNameFr: z.string().min(2).max(160).optional(),
  phone: z.string().min(6).max(40).optional(),
  addressAr: z.string().max(240).optional(),
  addressFr: z.string().max(240).optional(),
});
