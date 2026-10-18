/**
 * Convierte lo que escribe una persona en Colombia a un decimal con punto, SIN pasar por Number.
 *   "1.599.000" → "1599000"   (punto como separador de miles)
 *   "1.599.000,50" → "1599000.50"
 *   "1,5" → "1.5"             (coma decimal)
 *   "$ 25.000" → "25000"
 *   "2.5" → "2.5"             (punto decimal cuando no hay grupos de miles)
 * Devuelve null si no es un número reconocible.
 */
export function normalizeNumber(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().replace(/[\s$]/g, "");
  if (s === "") return null;
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // El último separador es el decimal; el otro, de miles.
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    s = s.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) && s.split(",").length > 2 ? s.replaceAll(",", "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replaceAll(".", "");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  s = s.replace(/^0+(?=\d)/, "");
  return negative ? `-${s}` : s;
}

/** Solo para mostrar estimaciones en pantalla (nunca para guardar). */
export function toDisplayNumber(input: string | number | null | undefined): number {
  const n = normalizeNumber(input);
  return n === null ? 0 : Number(n);
}
