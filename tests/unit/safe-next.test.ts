import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext (destino tras iniciar sesión)", () => {
  it("solo acepta enlaces de invitación internos", () => {
    const token = "A".repeat(43);
    expect(safeNext(`/invite/${token}`)).toBe(`/invite/${token}`);
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\evil.example",
      `/invite/${token}/../../dashboard`,
      `/invite/${token}?x=1`,
      "/dashboard",
      "/invite/corto",
      "javascript:alert(1)",
      null,
      undefined,
      42,
    ]) {
      expect(safeNext(bad)).toBeNull();
    }
  });
});
