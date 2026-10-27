import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    // Márgenes sobre el precio de venta para esta categoría (null = usar la configuración general).
    retailMargin: rate("retail_margin"),
    wholesaleMargin: rate("wholesale_margin"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("categories_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("categories_org_name_uq").on(t.organizationId, sql`lower(${t.name})`),
    check(
      "categories_margins_ck",
      sql`(${t.retailMargin} is null or (${t.retailMargin} >= 0 and ${t.retailMargin} < 100)) and (${t.wholesaleMargin} is null or (${t.wholesaleMargin} >= 0 and ${t.wholesaleMargin} < 100))`,
    ),
  ],
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
    // Heredado: foto única de versiones anteriores. Las fotos viven ahora en product_images.
    imagePath: text("image_path"),
    // Proveedor habitual (opcional). La FK compuesta (organization_id, supplier_id) se crea en la migración 0005
    // porque suppliers se define en purchasing.ts (así se evita una importación circular entre esquemas).
    supplierId: uuid("supplier_id"),
    // Márgenes propios del producto (null = los de la categoría o la configuración general).
    retailMargin: rate("retail_margin"),
    wholesaleMargin: rate("wholesale_margin"),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("products_org_id_uq").on(t.organizationId, t.id),
    index("products_org_name_idx").on(t.organizationId, t.name),
    check("products_status_ck", sql`${t.status} in ('active','archived')`),
    check(
      "products_margins_ck",
      sql`(${t.retailMargin} is null or (${t.retailMargin} >= 0 and ${t.retailMargin} < 100)) and (${t.wholesaleMargin} is null or (${t.wholesaleMargin} >= 0 and ${t.wholesaleMargin} < 100))`,
    ),
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
    /** Código de referencia del proveedor o del fabricante (se usa en la búsqueda). */
    referenceCode: text("reference_code"),
    /** Costo de referencia comercial en COP (resultado del cálculo de precios). NO es el costo contable: ese vive en stock_valuations. */
    costPrice: unitCost("cost_price").notNull().default("0"),
    /** Precio minorista PUBLICADO (el que usa Ventas). */
    salePrice: money("sale_price").notNull().default("0"),
    lowStockThreshold: qty("low_stock_threshold").notNull().default("0"),
    // --- Costo original y precios comerciales ---
    costAmount: unitCost("cost_amount").notNull().default("0"),
    costCurrency: text("cost_currency").$type<"COP" | "USD">().notNull().default("COP"),
    /** Gastos adicionales fijos por unidad, en COP (flete, nacionalización…). */
    extraCostCop: money("extra_cost_cop").notNull().default("0"),
    retailPriceMode: text("retail_price_mode").$type<"auto" | "manual">().notNull().default("auto"),
    /** Precio mayorista PUBLICADO (null = sin precio mayorista publicado). */
    wholesalePrice: money("wholesale_price"),
    wholesalePriceMode: text("wholesale_price_mode").$type<"auto" | "manual">().notNull().default("auto"),
    wholesaleMinQty: qty("wholesale_min_qty"),
    /** Valor agregado del precio mayorista: mayorista (sin IVA) = costo + valor (en plata o en % del costo). */
    wholesaleMarkupType: text("wholesale_markup_type").$type<"amount" | "percent">(),
    wholesaleMarkupValue: money("wholesale_markup_value"),
    suggestedRetailPrice: money("suggested_retail_price"),
    suggestedWholesalePrice: money("suggested_wholesale_price"),
    /** Resultado del último cálculo: ok | no_rate (sin tasa válida: se conservan los valores anteriores). */
    pricingStatus: text("pricing_status").$type<"ok" | "no_rate">(),
    pricingRate: numeric("pricing_rate", { precision: 18, scale: 6 }),
    pricingRateDate: date("pricing_rate_date"),
    pricingRateSource: text("pricing_rate_source"),
    pricingCostCop: unitCost("pricing_cost_cop"),
    pricingTotalCost: unitCost("pricing_total_cost"),
    pricingRetailMargin: rate("pricing_retail_margin"),
    pricingWholesaleMargin: rate("pricing_wholesale_margin"),
    pricingCalculatedAt: timestamp("pricing_calculated_at", { withTimezone: true }),
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
    check("product_variants_cost_ck", sql`${t.costAmount} >= 0 and ${t.extraCostCop} >= 0 and ${t.costCurrency} in ('COP','USD')`),
    check("product_variants_modes_ck", sql`${t.retailPriceMode} in ('auto','manual') and ${t.wholesalePriceMode} in ('auto','manual')`),
    check("product_variants_wholesale_ck", sql`(${t.wholesalePrice} is null or ${t.wholesalePrice} >= 0) and (${t.wholesaleMinQty} is null or ${t.wholesaleMinQty} > 0)`),
    check(
      "product_variants_wholesale_markup_ck",
      sql`(${t.wholesaleMarkupType} is null or ${t.wholesaleMarkupType} in ('amount','percent')) and (${t.wholesaleMarkupValue} is null or ${t.wholesaleMarkupValue} >= 0)`,
    ),
    index("product_variants_reference_idx").on(t.organizationId, sql`lower(${t.referenceCode})`),
    foreignKey({ name: "product_variants_product_fk", columns: [t.organizationId, t.productId], foreignColumns: [products.organizationId, products.id] }).onDelete("cascade"),
  ],
);

// Fotografías de productos. El archivo vive en el almacenamiento de objetos (o en stored_files con el driver
// "database", pensado para desarrollo); aquí solo se guardan los metadatos y la referencia.
export const productImages = pgTable(
  "product_images",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    storageDriver: text("storage_driver").$type<"database" | "s3">().notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    altText: text("alt_text").notNull().default(""),
    position: integer("position").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("product_images_org_id_uq").on(t.organizationId, t.id),
    index("product_images_product_idx").on(t.organizationId, t.productId, t.position),
    uniqueIndex("product_images_primary_uq").on(t.organizationId, t.productId).where(sql`${t.isPrimary}`),
    check("product_images_size_ck", sql`${t.size} > 0`),
    check("product_images_driver_ck", sql`${t.storageDriver} in ('database','s3')`),
    foreignKey({ name: "product_images_product_fk", columns: [t.organizationId, t.productId], foreignColumns: [products.organizationId, products.id] }).onDelete("cascade"),
  ],
);

// Historial de precios publicados (solo inserción).
export const priceHistory = pgTable(
  "price_history",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull(),
    kind: text("kind").$type<"retail" | "wholesale">().notNull(),
    oldPrice: money("old_price"),
    newPrice: money("new_price"),
    oldMode: text("old_mode").$type<"auto" | "manual">().notNull(),
    newMode: text("new_mode").$type<"auto" | "manual">().notNull(),
    /** auto: política automática · approval: aprobado en la vista previa · manual: fijado a mano · revert: vuelve a automático · import: importación */
    source: text("source").$type<"auto" | "approval" | "manual" | "revert" | "import">().notNull(),
    suggestedPrice: money("suggested_price"),
    rate: numeric("rate", { precision: 18, scale: 6 }),
    reason: text("reason"),
    userId: uuid("user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("price_history_variant_idx").on(t.organizationId, t.variantId, t.createdAt),
    index("price_history_org_idx").on(t.organizationId, t.createdAt),
    check("price_history_kind_ck", sql`${t.kind} in ('retail','wholesale')`),
    check("price_history_source_ck", sql`${t.source} in ('auto','approval','manual','revert','import')`),
    foreignKey({ name: "price_history_variant_fk", columns: [t.organizationId, t.variantId], foreignColumns: [productVariants.organizationId, productVariants.id] }).onDelete("cascade"),
  ],
);
