import { describe, expect, it } from "vitest";
import { summarizeCompanies, type OverviewCompany } from "@/server/modules/platform/overview";

const now = new Date("2026-11-03T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

function company(over: Partial<OverviewCompany> = {}): OverviewCompany {
  return {
    organizationId: "org",
    name: "Empresa",
    plan: "free",
    isDemo: false,
    createdAt: daysAgo(100),
    lastLoginAt: daysAgo(1),
    members: 1,
    products: 5,
    variants: 5,
    sales30d: 0,
    ownerPending: false,
    ...over,
  };
}

describe("resumen del panel de plataforma", () => {
  it("cuenta clientes, de pago e ingreso estimado, sin las demostraciones", () => {
    const s = summarizeCompanies([company({ plan: "pro" }), company({ plan: "pro" }), company(), company({ plan: "pro", isDemo: true })], now);
    expect(s).toMatchObject({ companies: 3, demos: 1, paying: 2, free: 1, monthlyIncome: "70000", withoutPrice: 0 });
  });

  it("no inventa ingreso para un plan sin precio definido", () => {
    const s = summarizeCompanies([company({ plan: "enterprise" }), company({ plan: "pro" })], now);
    expect(s).toMatchObject({ paying: 2, monthlyIncome: "35000", withoutPrice: 1 });
  });

  it("suma actividad, nuevas y totales", () => {
    const s = summarizeCompanies([company({ createdAt: daysAgo(3), members: 2, products: 7, sales30d: 4 }), company({ lastLoginAt: daysAgo(40), products: 1, sales30d: 1 })], now);
    expect(s).toMatchObject({ new30d: 1, active30d: 1, users: 3, products: 8, sales30d: 5 });
  });

  it("señala lo que necesita atención y deja fuera a las sanas y a las demostraciones", () => {
    const reasons = (c: Partial<OverviewCompany>) => summarizeCompanies([company(c)], now).attention.map((a) => a.reason);
    expect(reasons({})).toEqual([]);
    expect(reasons({ isDemo: true, members: 0 })).toEqual([]);
    expect(reasons({ members: 0, ownerPending: true })).toEqual(["El dueño aún no acepta la invitación"]);
    expect(reasons({ members: 0 })).toEqual(["El enlace del dueño venció"]);
    expect(reasons({ lastLoginAt: daysAgo(20) })).toEqual(["Nadie entra hace 20 días"]);
    expect(reasons({ lastLoginAt: null })).toEqual(["Nadie ha entrado todavía"]);
    expect(reasons({ products: 0 })).toEqual(["Todavía no carga productos"]);
    expect(reasons({ variants: 450 })).toEqual(["Cerca del límite de su plan: 450 de 500 productos"]);
    expect(reasons({ plan: "enterprise", variants: 999_999 })).toEqual([]);
  });

  it("marca más grave a un cliente de pago que dejó de entrar", () => {
    expect(summarizeCompanies([company({ plan: "pro", lastLoginAt: daysAgo(30) })], now).attention[0]?.tone).toBe("danger");
    expect(summarizeCompanies([company({ lastLoginAt: daysAgo(30) })], now).attention[0]?.tone).toBe("warning");
  });
});
