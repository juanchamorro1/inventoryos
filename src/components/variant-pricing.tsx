import { revertToAutoAction, setManualPriceAction } from "@/app/actions/pricing";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { ConfirmAction } from "./confirm-action";
import { ActionForm, FieldError, SubmitButton } from "./form";
import { Badge, inputClass } from "./ui";

export type PricedVariant = {
  id: string;
  sku: string;
  name: string;
  costAmount: string;
  costCurrency: "COP" | "USD";
  extraCostCop: string;
  salePrice: string;
  wholesalePrice: string | null;
  wholesaleMinQty: string | null;
  retailPriceMode: "auto" | "manual";
  wholesalePriceMode: "auto" | "manual";
  suggestedRetailPrice: string | null;
  suggestedWholesalePrice: string | null;
  pricingStatus: "ok" | "no_rate" | null;
  pricingRate: string | null;
  pricingRateDate: string | null;
  pricingCostCop: string | null;
  pricingTotalCost: string | null;
  pricingRetailMargin: string | null;
  pricingWholesaleMargin: string | null;
};

function ManualForm({ v, kind, current }: { v: PricedVariant; kind: "retail" | "wholesale"; current: string | null }) {
  const label = kind === "retail" ? "minorista" : "mayorista";
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary hover:underline">Fijar precio {label} manual</summary>
      <ActionForm action={setManualPriceAction} className="mt-2 space-y-2">
        <input type="hidden" name="variantId" value={v.id} />
        <input type="hidden" name="kind" value={kind} />
        <div>
          <label htmlFor={`mp-${kind}-${v.id}`} className="block text-xs font-medium">
            Precio {label} (sin impuesto)
          </label>
          <input id={`mp-${kind}-${v.id}`} name="price" inputMode="decimal" defaultValue={current ?? ""} required className={inputClass} />
          <FieldError name="price" />
        </div>
        <div>
          <label htmlFor={`mr-${kind}-${v.id}`} className="block text-xs font-medium">
            Motivo
          </label>
          <input id={`mr-${kind}-${v.id}`} name="reason" required minLength={3} maxLength={300} className={inputClass} placeholder="Ej.: precio de competencia" />
          <FieldError name="reason" />
        </div>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" name="acceptBelowCost" className="mt-0.5 h-4 w-4" /> Acepto venderlo por debajo del costo si es el caso.
        </label>
        <FieldError name="acceptBelowCost" />
        <SubmitButton variant="secondary" className="h-8 text-xs">
          Guardar precio manual
        </SubmitButton>
      </ActionForm>
    </details>
  );
}

function PriceCell({ v, kind, currency, canManage, roundedSuggested }: { v: PricedVariant; kind: "retail" | "wholesale"; currency: string; canManage: boolean; roundedSuggested: string | null }) {
  const published = kind === "retail" ? v.salePrice : v.wholesalePrice;
  const mode = kind === "retail" ? v.retailPriceMode : v.wholesalePriceMode;
  const cost = v.pricingTotalCost ? Number(v.pricingTotalCost) : null;
  const below = published !== null && cost !== null && Number(published) < cost;
  const pending = mode === "auto" && roundedSuggested !== null && (published === null || Number(published) !== Number(roundedSuggested));
  return (
    <div className="space-y-1">
      <p className="font-semibold">{published === null ? "Sin publicar" : formatMoney(published, currency)}</p>
      <p className="flex flex-wrap gap-1">
        <Badge tone={mode === "manual" ? "neutral" : "primary"}>{mode === "manual" ? "Manual" : "Automático"}</Badge>
        {pending && <Badge tone="warning">Nuevo: {formatMoney(roundedSuggested, currency)}</Badge>}
        {below && <Badge tone="danger">Bajo el costo</Badge>}
      </p>
      {mode === "manual" && roundedSuggested && <p className="text-xs text-muted">Automático sería {formatMoney(roundedSuggested, currency)}</p>}
      {canManage && (
        <div className="space-y-1">
          <ManualForm v={v} kind={kind} current={published} />
          {mode === "manual" && (
            <ConfirmAction
              action={revertToAutoAction}
              hidden={{ variantId: v.id, kind }}
              label="Volver a automático"
              size="sm"
              variant="secondary"
              requireReason
              title="¿Volver al precio automático?"
              description="Según la política de la empresa, el precio calculado se publicará de inmediato o quedará pendiente de aprobación."
              confirmLabel="Volver a automático"
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Desglose de costo y precios por variante. `rounded` trae el sugerido ya redondeado (lo que se publicaría). */
export function VariantPricing({ variants, currency, canManage, rounded }: { variants: PricedVariant[]; currency: string; canManage: boolean; rounded: Record<string, { retail: string | null; wholesale: string | null }> }) {
  return (
    <div className="space-y-4">
      {variants.map((v) => (
        <article key={v.id} className="rounded-lg border border-border p-4" aria-label={`Precios de ${v.sku}`}>
          <h3 className="mb-3 font-medium">
            {v.name || v.sku} <span className="text-xs font-normal text-muted">· {v.sku}</span>
          </h3>
          {v.pricingStatus === "no_rate" && (
            <p role="alert" className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              No hay una tasa válida: se conservan los últimos precios calculados. Consulta o registra la TRM en Precios.
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <dt className="text-xs text-muted">Costo original</dt>
              <dd className="num">
                {formatNumber(v.costAmount, 2)} {v.costCurrency}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Tasa aplicada</dt>
              <dd className="num">{v.costCurrency === "USD" ? (v.pricingRate ? `${formatNumber(v.pricingRate, 2)} (${formatDate(v.pricingRateDate)})` : "Sin tasa") : "No aplica (COP)"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Costo en COP</dt>
              <dd className="num">{v.pricingCostCop ? formatMoney(v.pricingCostCop, currency) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Gastos adicionales</dt>
              <dd className="num">{v.pricingCostCop && v.pricingTotalCost ? formatMoney(Number(v.pricingTotalCost) - Number(v.pricingCostCop), currency) : formatMoney(v.extraCostCop, currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Costo total</dt>
              <dd className="num font-semibold">{v.pricingTotalCost ? formatMoney(v.pricingTotalCost, currency) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Márgenes usados</dt>
              <dd className="num">
                {v.pricingRetailMargin ? `${formatPercent(v.pricingRetailMargin)} / ${formatPercent(v.pricingWholesaleMargin)}` : "—"}
              </dd>
            </div>
          </dl>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted">Precio minorista publicado</p>
              <p className="text-xs text-muted">Sugerido sin redondear: {v.suggestedRetailPrice ? formatMoney(v.suggestedRetailPrice, currency) : "—"}</p>
              <PriceCell v={v} kind="retail" currency={currency} canManage={canManage} roundedSuggested={rounded[v.id]?.retail ?? null} />
            </div>
            <div>
              <p className="text-xs text-muted">Precio mayorista publicado{v.wholesaleMinQty ? ` (desde ${formatNumber(v.wholesaleMinQty, 4)} unid.)` : ""}</p>
              <p className="text-xs text-muted">Sugerido sin redondear: {v.suggestedWholesalePrice ? formatMoney(v.suggestedWholesalePrice, currency) : "—"}</p>
              <PriceCell v={v} kind="wholesale" currency={currency} canManage={canManage} roundedSuggested={rounded[v.id]?.wholesale ?? null} />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
