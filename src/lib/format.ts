// Formato de presentación. Los valores llegan como texto decimal desde la base de datos;
// Intl requiere Number solo para mostrar (nunca para calcular).

const ZERO_DECIMAL = new Set(["CLP", "PYG", "JPY", "KRW"]);

export function formatMoney(value: string | number | null | undefined, currency = "COP") {
  const n = Number(value ?? 0);
  const digits = ZERO_DECIMAL.has(currency) ? 0 : currency === "COP" ? 0 : 2;
  try {
    return new Intl.NumberFormat("es-CO", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch {
    return `${currency} ${n.toFixed(digits)}`;
  }
}

export function formatQty(value: string | number | null | undefined) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 }).format(n);
}

export function formatNumber(value: string | number | null | undefined, digits = 0) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: digits }).format(Number(value ?? 0));
}

export function formatPercent(value: string | number | null | undefined) {
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(Number(value ?? 0))} %`;
}

export function formatDate(value: Date | string | null | undefined, timeZone = "America/Bogota") {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T12:00:00` : value) : value;
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined, timeZone = "America/Bogota") {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone }).format(d);
}
