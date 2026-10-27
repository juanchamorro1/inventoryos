import { quickPriceAction } from "@/app/actions/pricing";
import { formatMoney } from "@/lib/format";
import { ActionForm, FieldError, SubmitButton } from "./form";
import { Hint, inputClass, cx } from "./ui";

// Cambio rápido del precio desde la ficha del producto: se escribe lo que paga el cliente (con impuesto).
export function QuickPrice({ variantId, currentGross, taxName, currency, label }: { variantId: string; currentGross: number; taxName: string | null; currency: string; label?: string }) {
  const withTax = Boolean(taxName);
  return (
    <ActionForm action={quickPriceAction} className="space-y-3">
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="includesTax" value={withTax ? "true" : "false"} />
      <div>
        <label htmlFor={`qp-${variantId}`} className="mb-1 block text-sm font-medium">
          {label ?? "Nuevo precio"} {withTax ? `(lo que paga el cliente, con ${taxName})` : ""}
        </label>
        <div className="flex flex-wrap gap-2">
          <input id={`qp-${variantId}`} name="price" inputMode="decimal" required placeholder={formatMoney(currentGross, currency)} className={cx(inputClass, "h-12 max-w-56 text-lg")} />
          <SubmitButton className="h-12">Guardar precio</SubmitButton>
        </div>
        <Hint>Hoy: {formatMoney(currentGross, currency)}. Escríbelo como de costumbre, por ejemplo 80.200.</Hint>
        <FieldError name="price" />
      </div>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" name="acceptBelowCost" className="mt-0.5 h-4 w-4" /> Si queda por debajo de lo que me cuesta, lo acepto.
      </label>
      <FieldError name="acceptBelowCost" />
    </ActionForm>
  );
}
