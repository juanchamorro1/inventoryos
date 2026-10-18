import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, money, orgId, qty, unitCost } from "./columns";
import { productVariants } from "./catalog";
import { organizations, users } from "./platform";
import { locations, warehouses } from "./warehouses";

export const STOCK_DOCUMENT_TYPES = [
  "opening",
  "receipt",
  "issue",
  "adjustment",
  "transfer",
  "purchase_receipt",
  "purchase_receipt_reversal",
  "sale",
  "sale_return",
  "sale_cancellation",
  "reversal",
] as const;
export type StockDocumentType = (typeof STOCK_DOCUMENT_TYPES)[number];

// Documento contabilizado. Solo se insertan; nunca se modifican ni se borran (trigger + REVOKE).
export const stockDocuments = pgTable(
  "stock_documents",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    type: text("type").$type<StockDocumentType>().notNull(),
    reason: text("reason").notNull(),
    notes: text("notes"),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    reversesDocumentId: uuid("reverses_document_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("stock_documents_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("stock_documents_org_number_uq").on(t.organizationId, t.number),
    // Un documento solo puede reversarse una vez.
    uniqueIndex("stock_documents_reverses_uq").on(t.organizationId, t.reversesDocumentId).where(sql`${t.reversesDocumentId} is not null`),
    index("stock_documents_org_posted_idx").on(t.organizationId, t.postedAt),
    index("stock_documents_source_idx").on(t.organizationId, t.sourceType, t.sourceId),
    check(
      "stock_documents_type_ck",
      sql`${t.type} in ('opening','receipt','issue','adjustment','transfer','purchase_receipt','purchase_receipt_reversal','sale','sale_return','sale_cancellation','reversal')`,
    ),
    check("stock_documents_reason_ck", sql`length(trim(${t.reason})) > 0`),
    foreignKey({ name: "stock_documents_reverses_fk", columns: [t.organizationId, t.reversesDocumentId], foreignColumns: [t.organizationId, t.id] }),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull(),
    lineNo: integer("line_no").notNull(),
    variantId: uuid("variant_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    locationId: uuid("location_id").notNull(),
    // Con signo: positivo = entrada, negativo = salida.
    quantity: qty("quantity").notNull(),
    unitCost: unitCost("unit_cost").notNull(),
    // Con signo, igual que quantity.
    totalCost: money("total_cost").notNull(),
    locationQtyAfter: qty("location_qty_after").notNull(),
    warehouseQtyAfter: qty("warehouse_qty_after").notNull(),
    warehouseValueAfter: money("warehouse_value_after").notNull(),
    avgCostAfter: unitCost("avg_cost_after").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("stock_movements_doc_line_uq").on(t.organizationId, t.documentId, t.lineNo),
    index("stock_movements_variant_idx").on(t.organizationId, t.variantId, t.createdAt),
    index("stock_movements_created_idx").on(t.organizationId, t.createdAt),
    check("stock_movements_qty_ck", sql`${t.quantity} <> 0`),
    check("stock_movements_sign_ck", sql`sign(${t.totalCost}) in (0, sign(${t.quantity}))`),
    check("stock_movements_after_ck", sql`${t.locationQtyAfter} >= 0 and ${t.warehouseQtyAfter} >= 0 and ${t.warehouseValueAfter} >= 0`),
    foreignKey({ name: "stock_movements_document_fk", columns: [t.organizationId, t.documentId], foreignColumns: [stockDocuments.organizationId, stockDocuments.id] }),
    foreignKey({ name: "stock_movements_variant_fk", columns: [t.organizationId, t.variantId], foreignColumns: [productVariants.organizationId, productVariants.id] }),
    foreignKey({
      name: "stock_movements_location_fk",
      columns: [t.organizationId, t.warehouseId, t.locationId],
      foreignColumns: [locations.organizationId, locations.warehouseId, locations.id],
    }),
  ],
);

// Saldo físico por ubicación. Solo lo modifica el motor de contabilización.
export const stockBalances = pgTable(
  "stock_balances",
  {
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    locationId: uuid("location_id").notNull(),
    onHand: qty("on_hand").notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.variantId, t.locationId] }),
    index("stock_balances_wh_idx").on(t.organizationId, t.warehouseId),
    check("stock_balances_non_negative_ck", sql`${t.onHand} >= 0`),
    foreignKey({ name: "stock_balances_variant_fk", columns: [t.organizationId, t.variantId], foreignColumns: [productVariants.organizationId, productVariants.id] }),
    foreignKey({
      name: "stock_balances_location_fk",
      columns: [t.organizationId, t.warehouseId, t.locationId],
      foreignColumns: [locations.organizationId, locations.warehouseId, locations.id],
    }),
  ],
);

// Valoración por (variante, bodega): costo promedio ponderado móvil.
export const stockValuations = pgTable(
  "stock_valuations",
  {
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    quantity: qty("quantity").notNull().default("0"),
    totalValue: money("total_value").notNull().default("0"),
    avgCost: unitCost("avg_cost").notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.variantId, t.warehouseId] }),
    check("stock_valuations_non_negative_ck", sql`${t.quantity} >= 0 and ${t.totalValue} >= 0 and ${t.avgCost} >= 0`),
    check("stock_valuations_zero_ck", sql`${t.quantity} > 0 or ${t.totalValue} = 0`),
    foreignKey({ name: "stock_valuations_variant_fk", columns: [t.organizationId, t.variantId], foreignColumns: [productVariants.organizationId, productVariants.id] }),
    foreignKey({ name: "stock_valuations_warehouse_fk", columns: [t.organizationId, t.warehouseId], foreignColumns: [warehouses.organizationId, warehouses.id] }),
  ],
);
