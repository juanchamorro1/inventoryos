import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, money, orgId, qty, rate, unitCost } from "./columns";
import { productVariants } from "./catalog";
import { stockDocuments } from "./inventory";
import { organizations, users } from "./platform";
import { locations } from "./warehouses";

export const customers = pgTable(
  "customers",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    documentNumber: text("document_number"),
    email: text("email"),
    phone: text("phone"),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("customers_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("customers_org_doc_uq").on(t.organizationId, t.documentNumber).where(sql`${t.documentNumber} is not null`),
    index("customers_org_name_idx").on(t.organizationId, t.name),
    check("customers_status_ck", sql`${t.status} in ('active','archived')`),
  ],
);

export const SALE_STATUSES = ["confirmed", "partially_returned", "returned", "cancelled"] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const sales = pgTable(
  "sales",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    customerId: uuid("customer_id"),
    warehouseId: uuid("warehouse_id").notNull(),
    locationId: uuid("location_id").notNull(),
    status: text("status").$type<SaleStatus>().notNull().default("confirmed"),
    subtotal: money("subtotal").notNull(),
    discountTotal: money("discount_total").notNull(),
    taxTotal: money("tax_total").notNull(),
    total: money("total").notNull(),
    costTotal: money("cost_total").notNull(),
    paymentMethod: text("payment_method").notNull(),
    notes: text("notes"),
    stockDocumentId: uuid("stock_document_id").notNull(),
    cancellationDocumentId: uuid("cancellation_document_id"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    unique("sales_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("sales_org_number_uq").on(t.organizationId, t.number),
    index("sales_org_created_idx").on(t.organizationId, t.createdAt),
    check("sales_status_ck", sql`${t.status} in ('confirmed','partially_returned','returned','cancelled')`),
    check("sales_payment_ck", sql`${t.paymentMethod} in ('cash','card','transfer','credit','other')`),
    foreignKey({ name: "sales_customer_fk", columns: [t.organizationId, t.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    foreignKey({
      name: "sales_location_fk",
      columns: [t.organizationId, t.warehouseId, t.locationId],
      foreignColumns: [locations.organizationId, locations.warehouseId, locations.id],
    }),
    foreignKey({ name: "sales_doc_fk", columns: [t.organizationId, t.stockDocumentId], foreignColumns: [stockDocuments.organizationId, stockDocuments.id] }),
    foreignKey({ name: "sales_cancel_doc_fk", columns: [t.organizationId, t.cancellationDocumentId], foreignColumns: [stockDocuments.organizationId, stockDocuments.id] }),
  ],
);

export const saleLines = pgTable(
  "sale_lines",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id").notNull(),
    lineNo: integer("line_no").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantity: qty("quantity").notNull(),
    quantityReturned: qty("quantity_returned").notNull().default("0"),
    unitPrice: money("unit_price").notNull(),
    discount: money("discount").notNull().default("0"),
    taxRate: rate("tax_rate").notNull(),
    lineSubtotal: money("line_subtotal").notNull(),
    lineTax: money("line_tax").notNull(),
    lineTotal: money("line_total").notNull(),
    unitCost: unitCost("unit_cost").notNull(),
    lineCost: money("line_cost").notNull(),
  },
  (t) => [
    unique("sale_lines_org_id_uq").on(t.organizationId, t.id),
    index("sale_lines_sale_idx").on(t.organizationId, t.saleId),
    index("sale_lines_variant_idx").on(t.organizationId, t.variantId),
    check("sale_lines_qty_ck", sql`${t.quantity} > 0 and ${t.quantityReturned} >= 0 and ${t.quantityReturned} <= ${t.quantity}`),
    check("sale_lines_amounts_ck", sql`${t.unitPrice} >= 0 and ${t.discount} >= 0 and ${t.lineSubtotal} >= 0`),
    foreignKey({ name: "sale_lines_sale_fk", columns: [t.organizationId, t.saleId], foreignColumns: [sales.organizationId, sales.id] }),
    foreignKey({ name: "sale_lines_variant_fk", columns: [t.organizationId, t.variantId], foreignColumns: [productVariants.organizationId, productVariants.id] }),
  ],
);

export const saleReturns = pgTable(
  "sale_returns",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    saleId: uuid("sale_id").notNull(),
    reason: text("reason").notNull(),
    refundTotal: money("refund_total").notNull(),
    stockDocumentId: uuid("stock_document_id").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("sale_returns_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("sale_returns_org_number_uq").on(t.organizationId, t.number),
    index("sale_returns_sale_idx").on(t.organizationId, t.saleId),
    foreignKey({ name: "sale_returns_sale_fk", columns: [t.organizationId, t.saleId], foreignColumns: [sales.organizationId, sales.id] }),
    foreignKey({ name: "sale_returns_doc_fk", columns: [t.organizationId, t.stockDocumentId], foreignColumns: [stockDocuments.organizationId, stockDocuments.id] }),
  ],
);

export const saleReturnLines = pgTable(
  "sale_return_lines",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    saleReturnId: uuid("sale_return_id").notNull(),
    saleLineId: uuid("sale_line_id").notNull(),
    quantity: qty("quantity").notNull(),
    unitCost: unitCost("unit_cost").notNull(),
    refundAmount: money("refund_amount").notNull(),
  },
  (t) => [
    index("sale_return_lines_return_idx").on(t.organizationId, t.saleReturnId),
    check("sale_return_lines_qty_ck", sql`${t.quantity} > 0`),
    foreignKey({ name: "sale_return_lines_return_fk", columns: [t.organizationId, t.saleReturnId], foreignColumns: [saleReturns.organizationId, saleReturns.id] }),
    foreignKey({ name: "sale_return_lines_line_fk", columns: [t.organizationId, t.saleLineId], foreignColumns: [saleLines.organizationId, saleLines.id] }),
  ],
);
