import { dec } from "../../platform/decimal";
import { PLANS, type PlanId } from "../../platform/plans";

// Resumen del panel de plataforma: cálculo puro sobre las filas de empresas, sin acceso a la base.

export type OverviewCompany = {
  organizationId: string;
  name: string;
  plan: string;
  isDemo: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  members: number;
  products: number;
  variants: number;
  sales30d: number;
  ownerPending: boolean;
};

export const INACTIVE_AFTER_DAYS = 14;
const NEAR_LIMIT = 0.8;
const DAY_MS = 86_400_000;

export type AttentionItem = { organizationId: string; name: string; reason: string; tone: "warning" | "danger" };

export function summarizeCompanies<T extends OverviewCompany>(rows: T[], now = new Date()) {
  // Las empresas de demostración no cuentan como clientes.
  const clients = rows.filter((c) => !c.isDemo);
  const daysSince = (d: Date) => (now.getTime() - d.getTime()) / DAY_MS;
  const planOf = (c: T) => PLANS[c.plan as PlanId] ?? PLANS.free;
  const paying = clients.filter((c) => c.plan !== "free");
  const withoutPrice = paying.filter((c) => planOf(c).monthlyPrice === null).length;
  const monthlyIncome = paying.reduce((sum, c) => sum.plus(planOf(c).monthlyPrice ?? 0), dec(0));

  const attention: AttentionItem[] = [];
  for (const c of clients) {
    const base = { organizationId: c.organizationId, name: c.name };
    if (c.members === 0) {
      attention.push(c.ownerPending ? { ...base, reason: "El dueño aún no acepta la invitación", tone: "warning" } : { ...base, reason: "El enlace del dueño venció", tone: "danger" });
      continue;
    }
    if (!c.lastLoginAt || daysSince(c.lastLoginAt) > INACTIVE_AFTER_DAYS) {
      attention.push({ ...base, reason: c.lastLoginAt ? `Nadie entra hace ${Math.floor(daysSince(c.lastLoginAt))} días` : "Nadie ha entrado todavía", tone: c.plan === "free" ? "warning" : "danger" });
    }
    if (c.products === 0) attention.push({ ...base, reason: "Todavía no carga productos", tone: "warning" });
    if (Number.isFinite(planOf(c).maxVariants) && c.variants >= planOf(c).maxVariants * NEAR_LIMIT) {
      attention.push({ ...base, reason: `Cerca del límite de su plan: ${c.variants} de ${planOf(c).maxVariants} productos`, tone: "warning" });
    }
  }

  return {
    companies: clients.length,
    demos: rows.length - clients.length,
    paying: paying.length,
    free: clients.length - paying.length,
    /** Suma de los planes asignados, no cobros reales: no hay pagos integrados. */
    monthlyIncome: monthlyIncome.toFixed(0),
    withoutPrice,
    new30d: clients.filter((c) => daysSince(c.createdAt) <= 30).length,
    active30d: clients.filter((c) => c.lastLoginAt && daysSince(c.lastLoginAt) <= 30).length,
    users: clients.reduce((n, c) => n + c.members, 0),
    products: clients.reduce((n, c) => n + c.products, 0),
    sales30d: clients.reduce((n, c) => n + c.sales30d, 0),
    attention,
  };
}
