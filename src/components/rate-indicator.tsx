import Link from "next/link";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import type { EffectiveRate } from "@/server/modules/pricing/service";
import { Badge, cx } from "./ui";

// Indicador visible de la tasa con la que se calculan los precios de productos en USD.
export function RateIndicator({ rate, compact = false }: { rate: EffectiveRate; compact?: boolean }) {
  const tone = rate.status === "ok" ? "border-border bg-surface" : "border-warning/40 bg-warning-soft";
  const label = rate.status === "ok" ? "Vigente" : rate.status === "stale" ? "Obsoleta" : rate.status === "missing" ? "Sin tasa" : "No aplica";
  return (
    <div role={rate.status === "ok" ? "status" : "alert"} className={cx("rounded-xl border px-4 py-3 text-sm", tone)} data-testid="rate-indicator">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">Tasa USD → COP</span>
        <Badge tone={rate.status === "ok" ? "success" : "warning"}>{label}</Badge>
        {rate.trm && (
          <span>
            TRM <span className="num font-semibold">{formatNumber(rate.trm, 2)}</span> + ajuste <span className="num">{formatNumber(rate.adjustment, 2)}</span> ={" "}
            <span className="num font-semibold">{formatNumber(rate.applied, 2)}</span> COP/USD
          </span>
        )}
        {!compact && (
          <Link href="/pricing" className="text-primary hover:underline">
            Ver precios y tasas
          </Link>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        {rate.mode === "manual" ? "Tasa registrada manualmente" : (rate.attribution ?? "Fuente automática")}
        {rate.validFrom && ` · vigente desde ${formatDate(rate.validFrom)}`}
        {rate.validTo && ` hasta ${formatDate(rate.validTo)}`}
        {rate.recordedAt && ` · obtenida ${formatDateTime(rate.recordedAt)}`}
      </p>
      {rate.status !== "ok" && <p className="mt-1 text-sm">{rate.message}</p>}
    </div>
  );
}
