import { z } from "zod";
import { normalizeNumber } from "@/lib/parse-number";
import { D, type Dec } from "./decimal";
import { ValidationError } from "./errors";

/** Decimal recibido como texto o número; nunca se convierte a float. */
export function zDecimal(opts: { scale: number; min?: number; positive?: boolean; max?: string; label?: string }) {
  const label = opts.label ?? "El valor";
  return z
    .union([z.string(), z.number()])
    .transform((v, ctx): Dec => {
      const s = normalizeNumber(v);
      if (s === null) {
        ctx.addIssue({ code: "custom", message: `${label} debe ser un número, por ejemplo 1.599.000 o 2,5.` });
        return z.NEVER;
      }
      const d = new D(s);
      if (d.decimalPlaces() > opts.scale) {
        ctx.addIssue({ code: "custom", message: `${label} admite máximo ${opts.scale} decimales.` });
        return z.NEVER;
      }
      if (opts.positive && d.lte(0)) {
        ctx.addIssue({ code: "custom", message: `${label} debe ser mayor que cero.` });
        return z.NEVER;
      }
      if (opts.min !== undefined && d.lt(opts.min)) {
        ctx.addIssue({ code: "custom", message: `${label} debe ser al menos ${opts.min}.` });
        return z.NEVER;
      }
      if (opts.max !== undefined && d.gt(opts.max)) {
        ctx.addIssue({ code: "custom", message: `${label} no puede superar ${opts.max}.` });
        return z.NEVER;
      }
      return d;
    });
}

export const zQty = (label = "La cantidad") => zDecimal({ scale: 4, positive: true, max: "99999999999999", label });
export const zUnitCost = (label = "El costo") => zDecimal({ scale: 6, min: 0, max: "99999999999999", label });
export const zMoney = (label = "El valor") => zDecimal({ scale: 4, min: 0, max: "9999999999999999", label });
export const zUuid = (label = "Identificador") => z.string().uuid(`${label} inválido.`);
export const zIdempotencyKey = z.string().min(8).max(200).optional();

export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, raw: unknown, message = "Revisa los datos del formulario."): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    const fieldErrors = { ...flat.fieldErrors } as Record<string, string[]>;
    // Errores en elementos de listas (p. ej. lines.0.quantity) se agrupan con su ruta completa.
    for (const issue of parsed.error.issues) {
      if (issue.path.length > 1) {
        const key = issue.path.join(".");
        (fieldErrors[key] ??= []).push(issue.message);
      }
    }
    if (flat.formErrors.length) fieldErrors._form = flat.formErrors;
    const first = parsed.error.issues[0]?.message;
    throw new ValidationError(first && Object.keys(fieldErrors).length <= 1 ? first : message, fieldErrors);
  }
  return parsed.data;
}
