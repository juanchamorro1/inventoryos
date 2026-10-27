import Link from "next/link";
import { recalculateAction, refreshRateAction, setCategoryMarginsAction, setManualRateAction, updatePricingSettingsAction } from "@/app/actions/pricing";
import { ConfirmAction } from "@/components/confirm-action";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { BigAction } from "@/components/big-action";
import { RateIndicator } from "@/components/rate-indicator";
import { Badge, Card, Hint, Input, Label, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { trimDecimal as num } from "@/lib/decimal-text";
import { requireContext } from "@/server/auth/session";
import { listRateHistory } from "@/server/modules/exchange/service";
import { PROVIDERS } from "@/server/modules/exchange/providers";
import { ensurePricesCurrent, getPricingOverview, listCategoryMargins, listManualRates } from "@/server/modules/pricing/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Precios" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = { stored: "Tasa nueva", unchanged: "Sin cambios", rejected: "Rechazada", error: "Error" };

export default async function PricingPage() {
  const { ctx } = await requireContext();
  await ensurePricesCurrent(ctx);
  const [overview, categories, manualRates, rateHistory] = await Promise.all([getPricingOverview(ctx), listCategoryMargins(ctx), listManualRates(ctx, 10), listRateHistory(10)]);
  const { settings, rate, counts } = overview;
  const canManage = can(ctx, "pricing.manage");
  const simple = !settings.retailAutoEnabled;
  return (
    <>
      <PageHeader title="Precios" description={simple ? "Tú decides el precio de cada producto. Aquí tienes lo necesario para cambiarlos." : "La app calcula tus precios con el costo y tu margen. Aquí los revisas y apruebas."} />

      {counts.belowCost > 0 && (
        <div className="mb-4">
          <BigAction href="/products?pricing=below_cost" icon="alert" tone="danger" title={`${counts.belowCost} productos se venden por debajo de lo que te cuestan`} text="Ábrelos y corrige el precio." />
        </div>
      )}

      {simple ? (
        <>
          <Card title="Cómo cambiar tus precios" className="mb-6">
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>
                <strong>Un producto:</strong> ábrelo desde Productos y escribe el precio nuevo en «Cambiar precio».
              </li>
              <li>
                <strong>Muchos productos:</strong> descarga tu lista, cambia los precios en Excel y vuelve a subirla. Solo cambia lo que escribas.
              </li>
              <li>
                <strong>¿Qué cambió?</strong> Todo queda en el historial: precio anterior, nuevo, quién y cuándo.
              </li>
            </ol>
          </Card>
          <div className="mb-6 grid gap-3 sm:grid-cols-2">
            <BigAction href="/products" icon="box" title="Ver mis productos" text="Busca un producto y cambia su precio." primary />
            {canManage && <BigAction href="/products/import" icon="plus" title="Cambiar precios con Excel" text="Sube tu lista corregida (primero se valida, luego se aplica)." />}
            <BigAction href="/products/export" icon="clipboard" title="Descargar mi lista de productos" text="Ábrela en Excel para revisar o cambiar precios." download />
            <BigAction href="/pricing/history" icon="chart" title="Historial de precios" text="Mira cada cambio de precio." />
          </div>
          {canManage && (
            <p className="mb-6 text-sm text-muted">
              ¿Quieres que la app calcule los precios sola con tu margen?{" "}
              <Link href="/settings/pricing-modes" className="font-medium text-primary hover:underline">
                Enciende los precios automáticos
              </Link>
              .
            </p>
          )}
        </>
      ) : (
        <>
          <Card title="Cómo funciona" className="mb-6">
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>Escribe en cada producto <strong>cuánto te cuesta</strong>.</li>
              <li>
                La app calcula el precio para que te quede el <strong>{num(settings.retailMargin)} %</strong> del precio de venta (más el IVA al vender).
              </li>
              <li>
                Si cambia un costo{counts.usd > 0 ? " o el dólar" : ""}, los precios nuevos esperan en <strong>Cambios pendientes</strong> hasta que los apruebes.
              </li>
              <li>Un precio que escribas a mano queda fijo y la app no lo cambia.</li>
            </ol>
          </Card>
          <div className="mb-6 grid gap-3 sm:grid-cols-2">
            <BigAction href="/pricing/changes" icon="check" title={counts.pending ? `Revisar ${counts.pending} cambios pendientes` : "Cambios pendientes"} text={counts.pending ? "Mira el precio actual y el nuevo antes de aprobar." : "No hay nada por aprobar."} primary={counts.pending > 0} />
            <BigAction href="/products" icon="box" title="Ver mis productos" text="Cambia costos o fija precios a mano." />
            <BigAction href="/pricing/history" icon="chart" title="Historial de precios" text="Mira cada cambio de precio." />
            {canManage && <BigAction href="/products/import" icon="plus" title="Cambiar costos o precios con Excel" text="Sube tu lista corregida." />}
          </div>
          {counts.usd > 0 && (
            <div className="mb-6 space-y-3">
              <RateIndicator rate={rate} compact />
              {canManage && settings.rateMode === "auto" && (
                <ActionForm action={refreshRateAction} className="space-y-2">
                  <SubmitButton variant="secondary" pendingText="Consultando…">
                    Consultar el dólar (TRM) ahora
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          )}
        </>
      )}

      <details className="rounded-xl border border-border bg-surface p-4">
        <summary className="cursor-pointer font-semibold">Opciones avanzadas</summary>
        <p className="mt-2 text-sm text-muted">Márgenes, redondeo, tasa del dólar y otros ajustes. Normalmente no necesitas cambiarlos.</p>
        <div className="mt-4">
          {canManage && (
            <div className="mb-6">
              <ConfirmAction
                action={recalculateAction}
                label="Recalcular todos los precios"
                variant="secondary"
                title="¿Recalcular todos los precios?"
                description="Se recalculan los sugeridos con la tasa y los márgenes actuales. Los precios manuales no cambian; los automáticos se publican o quedan pendientes según la política."
                confirmLabel="Recalcular"
              />
            </div>
          )}

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Cambios pendientes" value={formatNumber(counts.pending)} tone={counts.pending ? "warning" : undefined} hint={<Link href="/pricing/changes">Revisar</Link>} />
            <Stat label="Con precio manual" value={formatNumber(counts.manual)} hint={<Link href="/products?pricing=manual">Ver productos</Link>} />
            <Stat label="Costo en USD" value={formatNumber(counts.usd)} hint={<Link href="/products?currency=USD">Ver productos</Link>} />
            <Stat label="Sin tasa válida" value={formatNumber(counts.noRate)} tone={counts.noRate ? "warning" : undefined} hint={<Link href="/products?pricing=no_rate">Ver productos</Link>} />
            <Stat label="Precio bajo el costo" value={formatNumber(counts.belowCost)} tone={counts.belowCost ? "danger" : undefined} hint={<Link href="/products?pricing=below_cost">Ver productos</Link>} />
          </div>
          {counts.usd === 0 && (
            <div className="mb-6">
              <RateIndicator rate={rate} compact />
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Márgenes, redondeo y política">
              <ActionForm action={updatePricingSettingsAction}>
                <fieldset disabled={!canManage} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="retailMargin" hint="% sobre el precio de venta">
                        Margen minorista
                      </Label>
                      <Input id="retailMargin" name="retailMargin" inputMode="decimal" defaultValue={num(settings.retailMargin)} required />
                      <FieldError name="retailMargin" />
                    </div>
                    <div>
                      <Label htmlFor="wholesaleMargin" hint="% sobre el precio de venta">
                        Margen mayorista
                      </Label>
                      <Input id="wholesaleMargin" name="wholesaleMargin" inputMode="decimal" defaultValue={num(settings.wholesaleMargin)} required />
                      <FieldError name="wholesaleMargin" />
                    </div>
                    <div>
                      <Label htmlFor="fxAdjustmentCop" hint="COP por USD">
                        Ajuste sobre la TRM
                      </Label>
                      <Input id="fxAdjustmentCop" name="fxAdjustmentCop" inputMode="decimal" defaultValue={num(settings.fxAdjustmentCop)} required />
                      <Hint>Tasa aplicada = TRM + este valor. Solo para costos en USD.</Hint>
                      <FieldError name="fxAdjustmentCop" />
                    </div>
                    <div>
                      <Label htmlFor="extraCostPercent" hint="% del costo convertido">
                        Gastos adicionales generales
                      </Label>
                      <Input id="extraCostPercent" name="extraCostPercent" inputMode="decimal" defaultValue={num(settings.extraCostPercent)} required />
                      <Hint>Se suman a los gastos fijos de cada producto.</Hint>
                      <FieldError name="extraCostPercent" />
                    </div>
                    <div>
                      <Label htmlFor="roundingMode">Redondeo del precio publicado</Label>
                      <Select id="roundingMode" name="roundingMode" defaultValue={settings.roundingMode}>
                        <option value="up">Al siguiente múltiplo</option>
                        <option value="nearest">Al múltiplo más cercano</option>
                        <option value="none">Sin redondeo</option>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="roundingStep" hint="COP">
                        Múltiplo
                      </Label>
                      <Input id="roundingStep" name="roundingStep" inputMode="decimal" defaultValue={num(settings.roundingStep)} required />
                      <FieldError name="roundingStep" />
                    </div>
                    <div>
                      <Label htmlFor="applyPolicy">Al cambiar la tasa o el costo</Label>
                      <Select id="applyPolicy" name="applyPolicy" defaultValue={settings.applyPolicy}>
                        <option value="approval">Requiere aprobación (vista previa)</option>
                        <option value="auto">Actualizar precios automáticos al instante</option>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="rateMode">Origen de la TRM</Label>
                      <Select id="rateMode" name="rateMode" defaultValue={settings.rateMode}>
                        <option value="auto">Automática ({PROVIDERS["datos-gov-co-trm"]!.label})</option>
                        <option value="manual">Manual (la registras tú)</option>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="maxRateAgeHours" hint="horas">
                        Tolerancia tras el fin de vigencia
                      </Label>
                      <Input id="maxRateAgeHours" name="maxRateAgeHours" inputMode="numeric" defaultValue={settings.maxRateAgeHours} required />
                      <Hint>Después, la tasa se considera obsoleta y no se generan precios nuevos para productos en USD.</Hint>
                      <FieldError name="maxRateAgeHours" />
                    </div>
                  </div>
                  {canManage && <SubmitButton>Guardar y recalcular</SubmitButton>}
                </fieldset>
              </ActionForm>
            </Card>

            <div className="space-y-6">
              <Card title="Registrar TRM manualmente">
                {canManage ? (
                  <ActionForm action={setManualRateAction} resetOnSuccess>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="rate" hint="COP por 1 USD, sin el ajuste">
                          TRM
                        </Label>
                        <Input id="rate" name="rate" inputMode="decimal" required placeholder="Ej.: 3.950,25" />
                        <FieldError name="rate" />
                      </div>
                      <div>
                        <Label htmlFor="validFrom">Vigente desde</Label>
                        <Input id="validFrom" name="validFrom" type="date" />
                        <FieldError name="validFrom" />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="reason">Motivo</Label>
                      <Input id="reason" name="reason" required minLength={3} maxLength={300} placeholder="Ej.: la fuente automática no responde" />
                      <FieldError name="reason" />
                    </div>
                    <Hint>Al registrarla, la empresa pasa a modo manual. Vuelve a «Automática» en la configuración cuando quieras.</Hint>
                    <SubmitButton>Registrar tasa</SubmitButton>
                  </ActionForm>
                ) : (
                  <p className="text-sm text-muted">Solo un propietario, administrador o gerente puede registrar tasas.</p>
                )}
                {manualRates.length > 0 && (
                  <ul className="mt-4 divide-y divide-border text-sm">
                    {manualRates.map((m) => (
                      <li key={m.id} className="py-2">
                        <span className="num font-medium">{formatNumber(m.rate, 2)}</span> desde {formatDate(m.validFrom)}
                        <span className="block text-xs text-muted">
                          {formatDateTime(m.createdAt)} · {m.userName} · {m.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Consultas a la fuente oficial">
                {rateHistory.fetches.length === 0 ? (
                  <p className="text-sm text-muted">Todavía no se ha consultado la TRM.</p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {rateHistory.fetches.map((f) => (
                      <li key={f.id} className="flex items-start justify-between gap-2 py-2">
                        <span>
                          {f.message}
                          <span className="block text-xs text-muted">
                            {formatDateTime(f.createdAt)} · {f.trigger === "cron" ? "Programada" : "Manual"}
                          </span>
                        </span>
                        <Badge tone={f.status === "stored" ? "success" : f.status === "unchanged" ? "neutral" : "danger"}>{STATUS_LABELS[f.status]}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <Card title="Márgenes por categoría" className="mt-6">
            <p className="mb-3 text-sm text-muted">
              Precedencia: margen del producto → margen de la categoría → configuración general ({num(settings.retailMargin)} % / {num(settings.wholesaleMargin)} %). Deja vacío para heredar.
            </p>
            {categories.length === 0 ? (
              <p className="text-sm text-muted">No hay categorías.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Categoría</Th>
                    <Th>Margen minorista / mayorista (%)</Th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.id}>
                      <Td className="font-medium">{c.name}</Td>
                      <Td>
                        <ActionForm action={setCategoryMarginsAction} className="flex flex-wrap items-center gap-2 space-y-0">
                          <input type="hidden" name="categoryId" value={c.id} />
                          <Input name="retailMargin" aria-label={`Margen minorista de ${c.name}`} inputMode="decimal" defaultValue={c.retailMargin ? num(c.retailMargin) : ""} placeholder={num(settings.retailMargin)} className="h-9 w-28" disabled={!canManage} />
                          <Input name="wholesaleMargin" aria-label={`Margen mayorista de ${c.name}`} inputMode="decimal" defaultValue={c.wholesaleMargin ? num(c.wholesaleMargin) : ""} placeholder={num(settings.wholesaleMargin)} className="h-9 w-28" disabled={!canManage} />
                          {canManage && (
                            <SubmitButton variant="secondary" className="h-9">
                              Guardar
                            </SubmitButton>
                          )}
                        </ActionForm>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {rateHistory.rates.length > 0 && (
            <Card title="TRM obtenidas" className="mt-6">
              <Table>
                <thead>
                  <tr>
                    <Th>Vigencia</Th>
                    <Th align="right">TRM</Th>
                    <Th>Fuente</Th>
                    <Th>Obtenida</Th>
                  </tr>
                </thead>
                <tbody>
                  {rateHistory.rates.map((r) => (
                    <tr key={r.id}>
                      <Td>
                        {formatDate(r.validFrom)} – {formatDate(r.validTo)}
                      </Td>
                      <Td align="right" className="num">
                        {formatNumber(r.rate, 2)}
                      </Td>
                      <Td className="text-muted">{PROVIDERS[r.provider]?.label ?? r.provider}</Td>
                      <Td className="text-muted">{formatDateTime(r.fetchedAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="mt-2 text-xs text-muted">{PROVIDERS["datos-gov-co-trm"]!.attribution}</p>
            </Card>
          )}
        </div>
      </details>
    </>
  );
}
