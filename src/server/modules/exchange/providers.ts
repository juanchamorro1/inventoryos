import { z } from "zod";
import { D, type Dec } from "../../platform/decimal";

// Proveedores de tasa de cambio (adaptadores). Cada proveedor devuelve una cotización ya VALIDADA o lanza
// ExchangeProviderError con un motivo legible. Nada aquí escribe en la base de datos.

export type Quote = {
  /** COP por 1 USD (sin ajustes). */
  rate: Dec;
  validFrom: string; // YYYY-MM-DD
  validTo: string; // YYYY-MM-DD
  raw: Record<string, unknown>;
};

export type ProviderContext = {
  /** Fecha de hoy en Bogotá (YYYY-MM-DD). */
  today: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  appToken?: string;
};

export interface ExchangeRateProvider {
  id: string;
  label: string;
  attribution: string;
  fetchLatest(ctx: ProviderContext): Promise<Quote>;
}

export class ExchangeProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "rejected" | "error",
  ) {
    super(message);
  }
}

// Límites de sensatez para la TRM (COP por USD). Fuera de este rango la respuesta se rechaza.
export const TRM_MIN = new D(1000);
export const TRM_MAX = new D(20000);

const isoDay = (v: string) => v.slice(0, 10);

/**
 * TRM oficial publicada por la Superintendencia Financiera de Colombia en el portal de datos abiertos
 * datos.gov.co (Socrata, conjunto «Tasa de Cambio Representativa del Mercado - TRM», id 32sa-8pi3).
 *   GET https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde DESC&$limit=5
 *   Campos: valor (número), unidad ("COP"), vigenciadesde, vigenciahasta (fechas).
 * Licencia CC BY-SA 4.0: se debe citar la fuente. Sin token la consulta comparte un límite por IP; con
 * EXCHANGE_RATE_APP_TOKEN (cabecera X-App-Token) el límite es propio. Al superar el límite responde 429.
 */
export const datosGovCoTrm: ExchangeRateProvider = {
  id: "datos-gov-co-trm",
  label: "TRM · Superintendencia Financiera de Colombia (datos.gov.co)",
  attribution: "Fuente: Superintendencia Financiera de Colombia, datos.gov.co (CC BY-SA 4.0)",
  async fetchLatest({ today, fetchImpl, timeoutMs, appToken }) {
    const url = "https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=5";
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { Accept: "application/json", ...(appToken ? { "X-App-Token": appToken } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      const name = (err as Error).name;
      throw new ExchangeProviderError(name === "TimeoutError" || name === "AbortError" ? `El proveedor no respondió en ${timeoutMs / 1000} s.` : "No se pudo conectar con el proveedor.", "error");
    }
    if (res.status === 429) throw new ExchangeProviderError("El proveedor limitó las consultas (429). Se reintentará más tarde.", "error");
    if (!res.ok) throw new ExchangeProviderError(`El proveedor respondió ${res.status}.`, "error");
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ExchangeProviderError("La respuesta del proveedor no es JSON válido.", "rejected");
    }
    return parseDatosGovCo(body, today);
  },
};

const recordSchema = z.object({
  valor: z.union([z.string(), z.number()]),
  unidad: z.string(),
  vigenciadesde: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  vigenciahasta: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
});

/** Valida la respuesta de datos.gov.co y elige la TRM aplicable a `today` (o la más reciente anterior). */
export function parseDatosGovCo(body: unknown, today: string): Quote {
  if (!Array.isArray(body) || body.length === 0) throw new ExchangeProviderError("El proveedor no devolvió registros.", "rejected");
  const records = body.map((r) => recordSchema.safeParse(r));
  const valid = records.flatMap((r) => (r.success ? [r.data] : []));
  if (valid.length === 0) throw new ExchangeProviderError("Los registros del proveedor no tienen el formato esperado.", "rejected");
  // El registro aplicable: el más reciente cuya vigencia ya empezó (nunca uno con vigencia futura).
  const candidates = valid
    .map((r) => ({ ...r, from: isoDay(r.vigenciadesde), to: isoDay(r.vigenciahasta) }))
    .filter((r) => r.from <= today)
    .sort((a, b) => (a.from < b.from ? 1 : -1));
  const chosen = candidates[0];
  if (!chosen) throw new ExchangeProviderError("El proveedor solo devolvió tasas con vigencia futura.", "rejected");
  if (chosen.unidad.trim().toUpperCase() !== "COP") throw new ExchangeProviderError(`Unidad inesperada: ${chosen.unidad}.`, "rejected");
  if (chosen.from > chosen.to) throw new ExchangeProviderError("Vigencia inválida (desde > hasta).", "rejected");
  const text = String(chosen.valor).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new ExchangeProviderError(`Valor de TRM inválido: ${text.slice(0, 20)}.`, "rejected");
  const rate = new D(text);
  if (rate.lt(TRM_MIN) || rate.gt(TRM_MAX)) throw new ExchangeProviderError(`TRM fuera del rango razonable (${rate.toString()}).`, "rejected");
  return { rate, validFrom: chosen.from, validTo: chosen.to, raw: { valor: text, unidad: chosen.unidad, vigenciadesde: chosen.vigenciadesde, vigenciahasta: chosen.vigenciahasta } };
}

export const PROVIDERS: Record<string, ExchangeRateProvider> = { [datosGovCoTrm.id]: datosGovCoTrm };
