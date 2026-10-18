import { describe, expect, it } from "vitest";
import { can, canAssignRole } from "@/server/platform/permissions";
import { passwordProblem, hashPassword, verifyPassword } from "@/server/modules/auth/password";

const user = (role: "owner" | "admin" | "manager" | "staff" | "viewer") => ({ role, actor: { type: "user" as const } });

describe("matriz de permisos", () => {
  it("viewer solo lee", () => {
    expect(can(user("viewer"), "catalog.read")).toBe(true);
    expect(can(user("viewer"), "catalog.write")).toBe(false);
    expect(can(user("viewer"), "sales.write")).toBe(false);
  });
  it("staff vende y recibe, pero no ajusta inventario ni gestiona miembros", () => {
    expect(can(user("staff"), "sales.write")).toBe(true);
    expect(can(user("staff"), "purchasing.receive")).toBe(true);
    expect(can(user("staff"), "inventory.write")).toBe(false);
    expect(can(user("staff"), "sales.manage")).toBe(false);
    expect(can(user("staff"), "members.manage")).toBe(false);
  });
  it("manager opera pero no administra la empresa", () => {
    expect(can(user("manager"), "inventory.write")).toBe(true);
    expect(can(user("manager"), "members.manage")).toBe(false);
    expect(can(user("manager"), "apikeys.manage")).toBe(false);
  });
  it("claves API: solo los alcances concedidos y nunca escritura", () => {
    const api = { role: "viewer" as const, actor: { type: "api_key" as const, apiKeyId: "x", scopes: ["catalog:read"] } };
    expect(can(api, "catalog.read")).toBe(true);
    expect(can(api, "inventory.read")).toBe(false);
    expect(can(api, "sales.write")).toBe(false);
  });
  it("no se pueden asignar roles superiores", () => {
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("manager", "admin")).toBe(false);
    expect(canAssignRole("owner", "owner")).toBe(true);
    expect(canAssignRole("admin", "staff")).toBe(true);
  });
});

describe("contraseñas", () => {
  it("valida la política", () => {
    expect(passwordProblem("corta1")).not.toBeNull();
    expect(passwordProblem("solamenteletras")).not.toBeNull();
    expect(passwordProblem("Larga y con 123")).toBeNull();
  });
  it("hash scrypt verificable y con sal aleatoria", async () => {
    const a = await hashPassword("ClaveSegura2026");
    const b = await hashPassword("ClaveSegura2026");
    expect(a).not.toBe(b);
    expect(await verifyPassword("ClaveSegura2026", a)).toBe(true);
    expect(await verifyPassword("otra-clave-2026", a)).toBe(false);
  });
});
