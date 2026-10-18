import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, money, orgId, qty, rate, unitCost, updatedAt } from "./columns";
import { organizations, users } from "./platform";

// Todas las tablas de negocio llevan organization_id y exponen UNIQUE(organization_id, id) para que
// las claves foráneas compuestas impidan referenciar filas de otra empresa.

export const categories = pgTable(
  "categories",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("categories_org_id_uq").on(t.organizationId, t.id), uniqueIndex("categories_org_name_uq").on(t.organizationId, sql`lower(${t.name})`)],
);

export const brands = pgTable(
  "brands",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("brands_org_id_uq").on(t.organizationId, t.id), uniqueIndex("brands_org_name_uq").on(t.organizationId, sql`lower(${t.name})`)],
);

export const taxRates = pgTable(
  "tax_rates",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rate: rate("rate").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("tax_rates_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("tax_rates_org_name_uq").on(t.organizationId, sql`lower(${t.name})`),
    check("tax_rates_rate_ck", sql`${t.rate} >= 0 and ${t.rate} <= 100`),
  ],
);

export type ProductOption = { name: string; values: string[] };

export const products = pgTable(
  "products",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    categoryId: uuid("category_id"),
    brandId: uuid("brand_id"),
    taxRateId: uuid("tax_rate_id"),
    unit: text("unit").notNull().default("unidad"),
    options: jsonb("options").$type<ProductOption[]>().notNull().default([]),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    imagePath: text("image_path"),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("products_org_id_uq").on(t.organizationId, t.id),
    index("products_org_name_idx").on(t.organizationId, t.name),
    check("products_status_ck", sql`${t.status} in ('active','archived')`),
    foreignKey({ name: "products_category_fk", columns: [t.organizationId, t.categoryId], foreignColumns: [categories.organizationId, categories.id] }),
    foreignKey({ name: "products_brand_fk", columns: [t.organizationId, t.brandId], foreignColumns: [brands.organizationId, brands.id] }),
    foreignKey({ name: "products_tax_rate_fk", columns: [t.organizationId, t.taxRateId], foreignColumns: [taxRates.organizationId, taxRates.id] }),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    name: text("name").notNull().default(""),
    optionValues: jsonb("option_values").$type<Record<string, string>>().notNull().default({}),
    costPrice: unitCost("cost_price").notNull().default("0"),
    salePrice: money("sale_price").notNull().default("0"),
    lowStockThreshold: qty("low_stock_threshold").notNull().default("0"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("product_variants_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("product_variants_org_sku_uq").on(t.organizationId, sql`lower(${t.sku})`),
    uniqueIndex("product_variants_org_barcode_uq").on(t.organizationId, t.barcode).where(sql`${t.barcode} is not null`),
    index("product_variants_product_idx").on(t.organizationId, t.productId),
    check("product_variants_status_ck", sql`${t.status} in ('active','archived')`),
    check("product_variants_prices_ck", sql`${t.costPrice} >= 0 and ${t.salePrice} >= 0 and ${t.lowStockThreshold} >= 0`),
    foreignKey({ name: "product_variants_product_fk", columns: [t.organizationId, t.productId], foreignColumns: [products.organizationId, products.id] }).onDelete("cascade"),
  ],
);
