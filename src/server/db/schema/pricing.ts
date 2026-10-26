import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, money, orgId, rate } from "./columns";
import { organizations, users } from "./platform";

// Configuración de precios por empresa (una fila por empresa; si no existe se usan los valores iniciales).
export const pricingSettings = pgTable(
  "pricing_settings",
  {
    organizationId: orgId()
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Ajuste sumado a la TRM al convertir costos en USD: tasa aplicada = TRM + ajuste. */
    fxAdjustmentCop: money("fx_adjustment_cop").notNull().default("100"),
    /** Márgenes sobre el precio de venta (%), configuración general. */
    retailMargin: rate("retail_margin").notNull().default("30"),
    wholesaleMargin: rate("wholesale_margin").notNull().default("20"),
    /** Gastos adicionales como porcentaje del costo convertido (flete, aranceles…), además del valor fijo por producto. */
    extraCostPercent: rate("extra_cost_percent").notNull().default("0"),
    roundingStep: money("rounding_step").notNull().default("100"),
    roundingMode: text("rounding_mode").$type<"up" | "nearest" | "none">().notNull().default("up"),
    /** auto: los precios automáticos se actualizan solos · approval: quedan pendientes en la vista previa. */
    applyPolicy: text("apply_policy").$type<"auto" | "approval">().notNull().default("approval"),
    /** auto: TRM del proveedor configurado · manual: última tasa registrada a mano por la empresa. */
    rateMode: text("rate_mode").$type<"auto" | "manual">().notNull().default("auto"),
    /** Horas de gracia después del fin de vigencia de la tasa antes de considerarla obsoleta. */
    maxRateAgeHours: integer("max_rate_age_hours").notNull().default(48),
    /** Tasa con la que se recalcularon por última vez los precios (detecta tasas nuevas). */
    lastRateKey: text("last_rate_key"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    check("pricing_settings_margins_ck", sql`${t.retailMargin} >= 0 and ${t.retailMargin} < 100 and ${t.wholesaleMargin} >= 0 and ${t.wholesaleMargin} < 100`),
    check("pricing_settings_values_ck", sql`${t.fxAdjustmentCop} >= 0 and ${t.extraCostPercent} >= 0 and ${t.extraCostPercent} <= 1000 and ${t.roundingStep} > 0 and ${t.maxRateAgeHours} between 1 and 720`),
    check("pricing_settings_modes_ck", sql`${t.roundingMode} in ('up','nearest','none') and ${t.applyPolicy} in ('auto','approval') and ${t.rateMode} in ('auto','manual')`),
  ],
);

// Tasas oficiales consultadas a un proveedor (globales: la TRM es la misma para todas las empresas). Solo inserción.
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    baseCurrency: text("base_currency").notNull().default("COP"),
    quoteCurrency: text("quote_currency").notNull().default("USD"),
    /** COP por 1 USD. */
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    provider: text("provider").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex("exchange_rates_provider_valid_uq").on(t.provider, t.quoteCurrency, t.validFrom),
    index("exchange_rates_latest_idx").on(t.quoteCurrency, t.validFrom),
    check("exchange_rates_rate_ck", sql`${t.rate} > 0 and ${t.validFrom} <= ${t.validTo}`),
  ],
);

// Registro de cada consulta al proveedor (correcta, sin cambios, rechazada o fallida). Solo inserción.
export const exchangeRateFetches = pgTable(
  "exchange_rate_fetches",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    provider: text("provider").notNull(),
    /** stored: tasa nueva · unchanged: ya se tenía · rejected: respuesta inválida · error: fallo de red, tiempo o límite */
    status: text("status").$type<"stored" | "unchanged" | "rejected" | "error">().notNull(),
    message: text("message"),
    rateId: bigint("rate_id", { mode: "number" }).references(() => exchangeRates.id),
    trigger: text("trigger").$type<"cron" | "manual">().notNull(),
    userId: uuid("user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("exchange_rate_fetches_created_idx").on(t.createdAt), check("exchange_rate_fetches_status_ck", sql`${t.status} in ('stored','unchanged','rejected','error')`)],
);

// Tasas registradas a mano por una empresa (modo manual). Solo inserción: cada cambio queda trazado.
export const manualExchangeRates = pgTable(
  "manual_exchange_rates",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    /** TRM en COP por 1 USD (el ajuste se suma aparte). */
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    validFrom: date("valid_from").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("manual_exchange_rates_org_idx").on(t.organizationId, t.createdAt), check("manual_exchange_rates_rate_ck", sql`${t.rate} > 0`)],
);
