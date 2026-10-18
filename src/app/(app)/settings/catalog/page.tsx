import {
  createBrandAction,
  createCategoryAction,
  createTaxRateAction,
  deleteBrandAction,
  deleteCategoryAction,
  deleteTaxRateAction,
  setDefaultTaxRateAction,
} from "@/app/actions/catalog";
import { ConfirmAction } from "@/components/confirm-action";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Badge, Card, Input, PageHeader } from "@/components/ui";
import { formatPercent } from "@/lib/format";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { listBrands, listCategories, listTaxRates } from "@/server/modules/catalog/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Categorías, marcas e impuestos" };

function NameForm({ action, placeholder }: { action: typeof createCategoryAction; placeholder: string }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-2">
      <div className="flex gap-2">
        <Input name="name" placeholder={placeholder} aria-label={placeholder} maxLength={80} required />
        <SubmitButton variant="secondary">Agregar</SubmitButton>
      </div>
      <FieldError name="name" />
    </ActionForm>
  );
}

export default async function CatalogSettingsPage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "catalog.write");
  const [categories, brands, taxes] = await Promise.all([listCategories(ctx), listBrands(ctx), listTaxRates(ctx)]);
  const manageTaxes = can(ctx, "settings.manage");
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Configuración" }} title="Categorías, marcas e impuestos" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Categorías">
          <NameForm action={createCategoryAction} placeholder="Nueva categoría" />
          <ul className="mt-4 divide-y divide-border text-sm">
            {categories.length === 0 && <li className="py-2 text-muted">Sin categorías.</li>}
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span>
                  {c.name} <span className="text-xs text-muted">({c.products})</span>
                </span>
                <ConfirmAction action={deleteCategoryAction} hidden={{ id: c.id }} label="Eliminar" size="sm" title={`¿Eliminar «${c.name}»?`} description="Solo es posible si ningún producto la usa." confirmLabel="Eliminar" />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Marcas">
          <NameForm action={createBrandAction} placeholder="Nueva marca" />
          <ul className="mt-4 divide-y divide-border text-sm">
            {brands.length === 0 && <li className="py-2 text-muted">Sin marcas.</li>}
            {brands.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2">
                <span>
                  {b.name} <span className="text-xs text-muted">({b.products})</span>
                </span>
                <ConfirmAction action={deleteBrandAction} hidden={{ id: b.id }} label="Eliminar" size="sm" title={`¿Eliminar «${b.name}»?`} description="Solo es posible si ningún producto la usa." confirmLabel="Eliminar" />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Impuestos de venta">
          {manageTaxes && (
            <ActionForm action={createTaxRateAction} resetOnSuccess className="space-y-2">
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <Input name="name" placeholder="Nombre (p. ej. IVA 8%)" aria-label="Nombre del impuesto" required maxLength={60} />
                <Input name="rate" placeholder="%" aria-label="Tarifa en porcentaje" inputMode="decimal" required />
              </div>
              <FieldError name="name" />
              <FieldError name="rate" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isDefault" /> Predeterminado
              </label>
              <SubmitButton variant="secondary">Agregar impuesto</SubmitButton>
            </ActionForm>
          )}
          <ul className="mt-4 divide-y divide-border text-sm">
            {taxes.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {t.name} <span className="text-xs text-muted">{formatPercent(t.rate)}</span> {t.isDefault && <Badge tone="primary">Predeterminado</Badge>}
                </span>
                {manageTaxes && (
                  <span className="flex gap-1">
                    {!t.isDefault && (
                      <ConfirmAction action={setDefaultTaxRateAction} hidden={{ id: t.id }} label="Predeterminar" size="sm" title={`¿Usar «${t.name}» por defecto en productos nuevos?`} confirmLabel="Confirmar" variant="primary" />
                    )}
                    <ConfirmAction action={deleteTaxRateAction} hidden={{ id: t.id }} label="Eliminar" size="sm" title={`¿Eliminar «${t.name}»?`} description="Solo si ningún producto lo usa. Las ventas pasadas conservan su tarifa." confirmLabel="Eliminar" />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
