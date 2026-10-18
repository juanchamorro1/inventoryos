import { formatMoney } from "@/lib/format";

/** Gráfico de barras agrupadas en SVG (renderizado en el servidor, sin dependencias). */
export function DailyBars({ data, currency }: { data: { day: string; sales: string; purchases: string }[]; currency: string }) {
  const max = Math.max(1, ...data.flatMap((d) => [Number(d.sales), Number(d.purchases)]));
  const width = 720;
  const height = 200;
  const pad = { top: 10, bottom: 24, left: 4, right: 4 };
  const slot = (width - pad.left - pad.right) / Math.max(1, data.length);
  const bar = Math.max(1, Math.min(14, slot / 2 - 1));
  const y = (v: number) => pad.top + (height - pad.top - pad.bottom) * (1 - v / max);
  const labelEvery = Math.ceil(data.length / 8);
  const hasData = data.some((d) => Number(d.sales) > 0 || Number(d.purchases) > 0);
  if (!hasData) return <p className="py-10 text-center text-sm text-muted">Aún no hay ventas ni compras en este periodo.</p>;
  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full" role="img" aria-label="Ventas y compras por día">
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="var(--color-border)" />
        {data.map((d, i) => {
          const x = pad.left + i * slot + slot / 2;
          const s = Number(d.sales);
          const p = Number(d.purchases);
          return (
            <g key={d.day}>
              <title>{`${d.day}: ventas ${formatMoney(s, currency)} · compras ${formatMoney(p, currency)}`}</title>
              <rect x={x - bar - 0.5} y={y(s)} width={bar} height={y(0) - y(s)} rx={2} fill="var(--color-primary)" />
              <rect x={x + 0.5} y={y(p)} width={bar} height={y(0) - y(p)} rx={2} fill="#9aa6b8" />
              {i % labelEvery === 0 && (
                <text x={x} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
                  {d.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" /> Ventas
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#9aa6b8]" /> Compras recibidas (costo)
        </span>
      </figcaption>
    </figure>
  );
}

export function HorizontalBars({ items, format }: { items: { label: string; value: number; hint?: string }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate">{i.label}</span>
            <span className="num shrink-0 text-muted">{format(i.value)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-bg">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
          </div>
          {i.hint && <p className="mt-0.5 text-xs text-muted">{i.hint}</p>}
        </li>
      ))}
    </ul>
  );
}
