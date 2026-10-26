import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { exchangeRateFetches, exchangeRates } from "../../db/schema";
import { withGlobalTx } from "../../db/tx";
import { env } from "../../env";
import { D } from "../../platform/decimal";
import { ExchangeProviderError, PROVIDERS, type ExchangeRateProvider } from "./providers";

// Consulta y registro de la TRM oficial (global: es la misma para todas las empresas).
//   - Se llama desde el cron (/api/cron/exchange-rate) o manualmente por un usuario autorizado.
//   - Cada consulta queda en exchange_rate_fetches; cada tasa válida en exchange_rates (ambas solo inserción).
//   - Una respuesta inválida, un fallo de red, un tiempo de espera o un límite del proveedor NO borran ni
//     reemplazan la última tasa válida: se registra el error y se conserva la anterior.

export const MANUAL_FETCH_MIN_MINUTES = 5;
const TIMEOUT_MS = 10_000;

/** Fecha de hoy en Bogotá (YYYY-MM-DD). */
export function todayBogota(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function configuredProvider(): ExchangeRateProvider | null {
  const { EXCHANGE_RATE_PROVIDER, NODE_ENV } = env();
  const id = EXCHANGE_RATE_PROVIDER ?? (NODE_ENV === "test" ? "none" : "datos-gov-co-trm");
  return id === "none" ? null : (PROVIDERS[id] ?? null);
}

export type RefreshResult =
  | { status: "disabled" | "skipped"; message: string }
  | { status: "stored" | "unchanged"; message: string; rate: string; validFrom: string; validTo: string }
  | { status: "rejected" | "error"; message: string };

export type RefreshOptions = {
  trigger: "cron" | "manual";
  userId?: string | null;
  /** Ignora el intervalo mínimo entre consultas automáticas (no el de las manuales). */
  force?: boolean;
  /** Para pruebas: proveedor y fetch inyectados (las pruebas nunca llaman a la red). */
  provider?: ExchangeRateProvider;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export async function latestOfficialRate(tx: Tx) {
  const [row] = await tx
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.quoteCurrency, "USD"))
    .orderBy(desc(exchangeRates.validFrom), desc(exchangeRates.id))
    .limit(1);
  return row ?? null;
}

export async function lastFetch(tx: Tx) {
  const [row] = await tx.select().from(exchangeRateFetches).orderBy(desc(exchangeRateFetches.id)).limit(1);
  return row ?? null;
}

export async function refreshExchangeRate(opts: RefreshOptions): Promise<RefreshResult> {
  const provider = opts.provider ?? configuredProvider();
  if (!provider) return { status: "disabled", message: "La consulta automática de la TRM está deshabilitada (EXCHANGE_RATE_PROVIDER=none)." };
  const now = opts.now ?? new Date();
  const cfg = env();

  // Intervalos mínimos: protegen el límite del proveedor y evitan consultas repetidas.
  const [recent] = await withGlobalTx((tx) =>
    tx
      .select({ createdAt: exchangeRateFetches.createdAt, trigger: exchangeRateFetches.trigger })
      .from(exchangeRateFetches)
      .where(and(eq(exchangeRateFetches.provider, provider.id), opts.trigger === "manual" ? eq(exchangeRateFetches.trigger, "manual") : sql`true`))
      .orderBy(desc(exchangeRateFetches.id))
      .limit(1),
  );
  if (recent) {
    const minutes = (now.getTime() - recent.createdAt.getTime()) / 60_000;
    if (opts.trigger === "manual" && minutes < MANUAL_FETCH_MIN_MINUTES) {
      return { status: "skipped", message: `Ya se consultó hace menos de ${MANUAL_FETCH_MIN_MINUTES} minutos. Inténtalo más tarde.` };
    }
    if (opts.trigger === "cron" && !opts.force && minutes < cfg.EXCHANGE_RATE_REFRESH_MINUTES) {
      return { status: "skipped", message: `Última consulta hace ${Math.floor(minutes)} min (intervalo ${cfg.EXCHANGE_RATE_REFRESH_MINUTES} min).` };
    }
  }

  const log = (status: "stored" | "unchanged" | "rejected" | "error", message: string, rateId: number | null = null) =>
    withGlobalTx((tx) => tx.insert(exchangeRateFetches).values({ provider: provider.id, status, message: message.slice(0, 500), rateId, trigger: opts.trigger, userId: opts.userId ?? null }));

  let quote;
  try {
    quote = await provider.fetchLatest({ today: todayBogota(now), fetchImpl: opts.fetchImpl ?? fetch, timeoutMs: TIMEOUT_MS, appToken: cfg.EXCHANGE_RATE_APP_TOKEN });
  } catch (err) {
    const kind = err instanceof ExchangeProviderError ? err.kind : "error";
    const message = err instanceof ExchangeProviderError ? err.message : "Error inesperado al consultar el proveedor.";
    if (!(err instanceof ExchangeProviderError)) console.error("[exchange] error inesperado", err);
    await log(kind, message);
    return { status: kind, message };
  }

  return withGlobalTx(async (tx) => {
    // Serializa consultas simultáneas (cron + manual) para no registrar dos veces la misma tasa.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('inventoryos.exchange_rates'))`);
    const previous = await latestOfficialRate(tx);
    if (previous && previous.validFrom === quote.validFrom && previous.provider === provider.id) {
      const message = `Sin cambios: TRM ${quote.rate.toString()} vigente desde ${quote.validFrom}.`;
      await tx.insert(exchangeRateFetches).values({ provider: provider.id, status: "unchanged", message, rateId: previous.id, trigger: opts.trigger, userId: opts.userId ?? null });
      return { status: "unchanged", message, rate: previous.rate, validFrom: previous.validFrom, validTo: previous.validTo };
    }
    if (previous && quote.validFrom < previous.validFrom) {
      const message = `El proveedor devolvió una tasa anterior (${quote.validFrom}) a la vigente (${previous.validFrom}); se conserva la vigente.`;
      await tx.insert(exchangeRateFetches).values({ provider: provider.id, status: "rejected", message, trigger: opts.trigger, userId: opts.userId ?? null });
      return { status: "rejected", message };
    }
    if (previous) {
      const prev = new D(previous.rate);
      const jump = quote.rate.minus(prev).abs().div(prev).times(100);
      if (jump.gt(cfg.EXCHANGE_RATE_MAX_JUMP_PERCENT)) {
        const message = `Variación de ${jump.toFixed(1)} % frente a la última TRM (${prev.toString()}): supera el ${cfg.EXCHANGE_RATE_MAX_JUMP_PERCENT} % permitido. Se conserva la anterior; revísala y, si es correcta, regístrala manualmente.`;
        await tx.insert(exchangeRateFetches).values({ provider: provider.id, status: "rejected", message, trigger: opts.trigger, userId: opts.userId ?? null });
        return { status: "rejected", message };
      }
    }
    const [row] = await tx
      .insert(exchangeRates)
      .values({ rate: quote.rate.toFixed(6), provider: provider.id, validFrom: quote.validFrom, validTo: quote.validTo, raw: quote.raw })
      .onConflictDoNothing()
      .returning({ id: exchangeRates.id });
    const message = `TRM ${quote.rate.toString()} vigente del ${quote.validFrom} al ${quote.validTo}.`;
    await tx.insert(exchangeRateFetches).values({ provider: provider.id, status: row ? "stored" : "unchanged", message, rateId: row?.id ?? null, trigger: opts.trigger, userId: opts.userId ?? null });
    return { status: row ? "stored" : "unchanged", message, rate: quote.rate.toFixed(6), validFrom: quote.validFrom, validTo: quote.validTo };
  });
}

/** Historial de tasas y de consultas (global, solo lectura). */
export async function listRateHistory(limit = 30) {
  return withGlobalTx(async (tx) => ({
    rates: await tx.select().from(exchangeRates).orderBy(desc(exchangeRates.validFrom), desc(exchangeRates.id)).limit(Math.min(limit, 200)),
    fetches: await tx.select().from(exchangeRateFetches).orderBy(desc(exchangeRateFetches.id)).limit(Math.min(limit, 200)),
  }));
}
