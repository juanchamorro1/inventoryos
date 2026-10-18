import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, qty, rate, unitCost } from "./columns";
import { productVariants } from "./catalog";
import { stockDocuments } from "./inventory";
import { organizations, users } from "./platform";
import { locations, warehouses } from "./warehouses";

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    taxId: text("tax_id"),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("suppliers_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("suppliers_org_tax_uq").on(t.organizationId, t.taxId).where(sql`${t.taxId} is not null`),
    index("suppliers_org_name_idx").on(t.organizationId, t.name),
    check("suppliers_status_ck", sql`${t.status} in ('active','archived')`),
  ],
);

export const PURCHASE_ORDER_STATUSES = ["draft", "ordered", "partially_received", "received", "closed", "cancelled"] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    status: text("status").$type<PurchaseOrderStatus>().notNull().default("draft"),
    expectedDate: date("expected_date"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    orderedAt: timestamp("ordered_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    unique("purchase_orders_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("purchase_orders_org_number_uq").on(t.organizationId, t.number),
    index("purchase_orders_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    check("purchase_orders_status_ck", sql`${t.status} in ('draft','ordered','partially_received','received','closed','cancelled')`),
    foreignKey({ name: "purchase_orders_supplier_fk", columns: [t.organizationId, t.supplierId], foreignColumns: [suppliers.organizationId, suppliers.id] }),
    foreignKey({ name: "purchase_orders_warehouse_fk", columns: [t.organizationId, t.warehouseId], foreignColumns: [warehouses.organizationId, warehouses.id] }),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    lineNo: integer("line_no").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantityOrdered: qty("quantity_ordered").notNull(),
    quantityReceived: qty("quantity_received").notNull().default("0"),
    unitCost: unitCost("unit_cost").notNull(),
    taxRate: rate("tax_rate").notNull().default("0"),
  },
  (t) => [
    unique("purchase_order_lines_org_id_uq").on(t.organizationId, t.id),
    index("purchase_order_lines_po_idx").on(t.organizationId, t.purchaseOrderId),
    check("purchase_order_lines_qty_ck", sql`${t.quantityOrdered} > 0 and ${t.quantityReceived} >= 0 and ${t.quantityReceived} <= ${t.quantityOrdered}`),
    check("purchase_order_lines_cost_ck", sql`${t.unitCost} >= 0`),
    foreignKey({ name: "purchase_order_lines_po_fk", columns: [t.organizationId, t.purchaseOrderId], foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id] }).onDelete("cascade"),
    foreignKey({ name: "purchase_order_lines_variant_fk", columns: [t.organizationId, t.variantId], foreignColumns: [productVariants.organizationId, productVariants.id] }),
  ],
);

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    locationId: uuid("location_id").notNull(),
    stockDocumentId: uuid("stock_document_id").notNull(),
    reversalDocumentId: uuid("reversal_document_id"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
  },
  (t) => [
    unique("goods_receipts_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("goods_receipts_org_number_uq").on(t.organizationId, t.number),
    index("goods_receipts_po_idx").on(t.organizationId, t.purchaseOrderId),
    foreignKey({ name: "goods_receipts_po_fk", columns: [t.organizationId, t.purchaseOrderId], foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id] }),
    foreignKey({
      name: "goods_receipts_location_fk",
      columns: [t.organizationId, t.warehouseId, t.locationId],
      foreignColumns: [locations.organizationId, locations.warehouseId, locations.id],
    }),
    foreignKey({ name: "goods_receipts_doc_fk", columns: [t.organizationId, t.stockDocumentId], foreignColumns: [stockDocuments.organizationId, stockDocuments.id] }),
    foreignKey({ name: "goods_receipts_rev_doc_fk", columns: [t.organizationId, t.reversalDocumentId], foreignColumns: [stockDocuments.organizationId, stockDocuments.id] }),
  ],
);

export const goodsReceiptLines = pgTable(
  "goods_receipt_lines",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    goodsReceiptId: uuid("goods_receipt_id").notNull(),
    purchaseOrderLineId: uuid("purchase_order_line_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantity: qty("quantity").notNull(),
    unitCost: unitCost("unit_cost").notNull(),
  },
  (t) => [
    index("goods_receipt_lines_receipt_idx").on(t.organizationId, t.goodsReceiptId),
    check("goods_receipt_lines_qty_ck", sql`${t.quantity} > 0`),
    foreignKey({ name: "goods_receipt_lines_receipt_fk", columns: [t.organizationId, t.goodsReceiptId], foreignColumns: [goodsReceipts.organizationId, goodsReceipts.id] }),
    foreignKey({
      name: "goods_receipt_lines_po_line_fk",
      columns: [t.organizationId, t.purchaseOrderLineId],
      foreignColumns: [purchaseOrderLines.organizationId, purchaseOrderLines.id],
    }),
    foreignKey({ name: "goods_receipt_lines_variant_fk", columns: [t.organizationId, t.variantId], foreignColumns: [productVariants.organizationId, productVariants.id] }),
  ],
);
