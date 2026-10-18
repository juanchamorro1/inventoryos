import Link from "next/link";
import { DailyBars, HorizontalBars } from "@/components/charts";
import { Icon, type IconName } from "@/components/icons";
import { Card, cx, PageHeader, Stat } from "@/components/ui";
import { formatMoney, formatNumber, formatQty } from "@/lib/format";
import { requireContext } from "@/server/auth/session";
import { getDashboard, getSetupProgress, PERIODS, type Period } from "@/server/modules/analytics/service";
import { lowStock } from "@/server/modules/inventory/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Inicio" };

function ActionCard({ href, icon, title, text }: { href: string; icon: IconName; title: string; text: string }) {
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition hover:border-primary hover:shadow-sm">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
        <Icon name={icon} />
      </span>
      <span>
        <span className="block font-semibold group-hover:text-primary">{title}</span>
        <span className="block text-sm text-muted">{text}</span>
      </span>
    </Link>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { ctx, session } = await requireContext();
  const actions: { href: string; icon: IconName; title: string; text: string; show: boolean }[] = [
    { href: "/sales/new", icon: "cart", title: "Registrar una venta", text: "Busca o escanea el producto y cobra.", show: can(ctx, "sales.write") },
    { href: "/purchasing/orders?status=ordered", icon: "truck", title: "Recibir mercancía", text: "Llegó un pedido de un proveedor.", show: can(ctx, "purchasing.receive") },
    { href: "/products/new", icon: "plus", title: "Agregar un producto", text: "Nombre, precio y cantidad que tienes.", show: can(ctx, "catalog.write") },
    { href: "/inventory/new", icon: "boxes", title: "Ajustar el inventario", text: "Ingresar, sacar, contar o mover mercancía.", show: can(ctx, "inventory.write") },
    { href: "/inventory", icon: "box", title: "Consultar existencias", text: "Cuánto tienes de cada producto.", show: !can(ctx, "inventory.write") && can(ctx, "inventory.read") },
  ];
  const visibleActions = actions.filter((a) => a.show);
  const firstName = session.user.name.split(" ")[0];

  const progress = can(ctx, "catalog.write") ? await getSetupProgress(ctx) : null;
  const steps = progress
    ? [
        { done: progress.products, label: "Agrega tus productos", href: "/products/new", hint: "Uno por uno o varios a la vez desde Excel (CSV)." },
        { done: progress.stock, label: "Registra la cantidad que tienes", href: "/inventory/new?type=receipt", hint: "Así el sistema sabe tus existencias de hoy." },
        { done: progress.supplier, label: "Agrega a tus proveedores", href: "/purchasing/suppliers/new", hint: "Para hacer y recibir pedidos." },
        { done: progress.sale, label: "Haz tu primera venta", href: "/sales/new", hint: "Las existencias se descuentan solas." },
      ]
    : [];
  const pending = steps.filter((s) => !s.done).length;

  const header = (
    <PageHeader title={`Hola, ${firstName}`} description="¿Qué quieres hacer hoy?" />
  );
  const actionGrid = (
    <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {visibleActions.map((a) => (
        <ActionCard key={a.href} {...a} />
      ))}
    </div>
  );
  const checklist =
    pending > 0 ? (
      <Card title={`Primeros pasos (${steps.length - pending} de ${steps.length})`} className="mb-8">
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-start gap-3">
              <span
                className={cx(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  s.done ? "bg-success text-white" : "border border-border text-muted",
                )}
              >
                {s.done ? <Icon name="check" className="h-4 w-4" /> : i + 1}
              </span>
              <div>
                {s.done ? (
                  <span className="text-muted line-through">{s.label}</span>
                ) : (
                  <Link href={s.href} className="font-medium text-primary hover:underline">
                    {s.label}
                  </Link>
                )}
                {!s.done && <p className="text-sm text-muted">{s.hint}</p>}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    ) : null;

  if (!can(ctx, "reports.read")) {
    return (
      <>
        {header}
        {actionGrid}
      </>
    );
  }

  const sp = await searchParams;
  const days = (PERIODS.includes(Number(sp.days) as Period) ? Number(sp.days) : 30) as Period;
  const [d, low] = await Promise.all([getDashboard(ctx, days), lowStock(ctx, 6)]);
  const cur = d.currency;
  const revenue = Number(d.sales.revenue) - Number(d.sales.returns);
  const profit = revenue - (Number(d.sales.cost) - Number(d.sales.returnsCost));
  const periodLabel = days === 365 ? "el último año" : `los últimos ${days} días`;

  return (
    <>
      {header}
      {actionGrid}
      {checklist}

      {Number(d.stock.skus) > 0 && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Cómo va tu negocio en {periodLabel}</h2>
            <nav className="flex rounded-lg border border-border bg-surface p-0.5 text-sm" aria-label="Periodo">
              {PERIODS.map((p) => (
                <Link key={p} href={`/dashboard?days=${p}`} className={cx("rounded-md px-3 py-1.5", p === days ? "bg-primary text-white" : "text-muted hover:text-ink")}>
                  {p === 365 ? "1 año" : `${p} días`}
                </Link>
              ))}
            </nav>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Vendiste" value={formatMoney(revenue, cur)} hint={`${d.sales.count} ventas${Number(d.sales.returns) > 0 ? ` · se devolvieron ${formatMoney(d.sales.returns, cur)}` : ""}`} />
            <Stat
              label="Ganaste (aprox.)"
              value={formatMoney(profit, cur)}
              hint={revenue > 0 ? `Ventas menos lo que te costaron los productos (${formatNumber((profit / revenue) * 100, 1)} %)` : "Aún no hay ventas en el periodo"}
              tone={profit < 0 ? "danger" : undefined}
            />
            <Stat label="Tu inventario vale" value={formatMoney(d.stock.value, cur)} hint={`${formatQty(d.stock.units)} unidades a precio de costo`} />
            <Stat
              label="Productos por agotarse"
              value={formatNumber(d.stock.low)}
              hint={Number(d.stock.out_of_stock) > 0 ? `${d.stock.out_of_stock} ya están agotados` : "Ninguno agotado"}
              tone={Number(d.stock.low) > 0 ? "warning" : undefined}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card
              title="Productos por agotarse"
              actions={
                <Link className="text-sm text-primary hover:underline" href="/inventory/alerts">
                  Ver todos
                </Link>
              }
            >
              {low.length === 0 ? (
                <p className="text-sm text-muted">Todo bien: ningún producto está por debajo de la cantidad mínima que definiste.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {low.map((l) => (
                    <li key={l.variantId} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/products/${l.productId}`} className="min-w-0 hover:underline">
                        <span className="block truncate">{l.variantName ? `${l.productName} · ${l.variantName}` : l.productName}</span>
                      </Link>
                      <span className={cx("num shrink-0", Number(l.quantity) === 0 ? "font-semibold text-danger" : "text-warning")}>
                        {Number(l.quantity) === 0 ? "Agotado" : `Quedan ${formatQty(l.quantity)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Lo más vendido">
              {d.topProducts.length === 0 ? (
                <p className="text-sm text-muted">Cuando registres ventas verás aquí tus productos estrella.</p>
              ) : (
                <HorizontalBars
                  items={d.topProducts.slice(0, 6).map((p) => ({ label: p.name, value: Number(p.units), hint: `${formatMoney(p.revenue, cur)} en ventas` }))}
                  format={(v) => `${formatQty(v)} vendidos`}
                />
              )}
            </Card>
          </div>

          <Card title="Ventas y compras por día">
            <DailyBars data={d.daily} currency={cur} />
          </Card>

          <Card title="Inventario por bodega">
            <ul className="divide-y divide-border text-sm">
              {d.byWarehouse.map((w) => (
                <li key={w.name} className="flex justify-between py-2">
                  <span>{w.name}</span>
                  <span className="num text-muted">
                    {formatQty(w.units)} unidades · {formatMoney(w.value, cur)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
