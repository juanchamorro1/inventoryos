/** "1599000.0000" → "1599000"; "1.5000" → "1.5". Sin pasar por Number (evita pérdida de precisión). */
export const trimDecimal = (v: string) => (v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);
