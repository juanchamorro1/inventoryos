import { describe, expect, it } from "vitest";
import { datosGovCoTrm, ExchangeProviderError, parseDatosGovCo } from "@/server/modules/exchange/providers";

// Respuesta real de datos.gov.co (dataset 32sa-8pi3) consultada al implementar la integración.
const SAMPLE = [
  { valor: "3158.43", unidad: "COP", vigenciadesde: "2026-10-24T00:00:00.000", vigenciahasta: "2026-10-26T00:00:00.000" },
  { valor: "3185.01", unidad: "COP", vigenciadesde: "2026-10-23T00:00:00.000", vigenciahasta: "2026-10-23T00:00:00.000" },
  { valor: "3191.47", unidad: "COP", vigenciadesde: "2026-10-22T00:00:00.000", vigenciahasta: "2026-10-22T00:00:00.000" },
];

const rejected = (fn: () => unknown, message: RegExp) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ExchangeProviderError);
    expect((err as ExchangeProviderError).kind).toBe("rejected");
    expect((err as Error).message).toMatch(message);
    return;
  }
  throw new Error("se esperaba un rechazo");
};

describe("TRM de datos.gov.co: validación de la respuesta", () => {
  it("elige la TRM vigente para hoy (fin de semana incluido)", () => {
    const q = parseDatosGovCo(SAMPLE, "2026-10-26");
    expect(q.rate.toString()).toBe("3158.43");
    expect(q).toMatchObject({ validFrom: "2026-10-24", validTo: "2026-10-26" });
  });
  it("nunca usa una tasa con vigencia futura", () => {
    const q = parseDatosGovCo(SAMPLE, "2026-10-23");
    expect(q.rate.toString()).toBe("3185.01");
    rejected(() => parseDatosGovCo(SAMPLE, "2026-10-01"), /vigencia futura/);
  });
  it("rechaza unidad distinta de COP, valores no numéricos o fuera de rango", () => {
    rejected(() => parseDatosGovCo([{ ...SAMPLE[0], unidad: "USD" }], "2026-10-26"), /Unidad/);
    rejected(() => parseDatosGovCo([{ ...SAMPLE[0], valor: "3.158,43" }], "2026-10-26"), /inválido/);
    rejected(() => parseDatosGovCo([{ ...SAMPLE[0], valor: "0" }], "2026-10-26"), /rango/);
    rejected(() => parseDatosGovCo([{ ...SAMPLE[0], valor: "999999" }], "2026-10-26"), /rango/);
    rejected(() => parseDatosGovCo([{ ...SAMPLE[0], vigenciadesde: "2026-10-27T00:00:00", vigenciahasta: "2026-10-20T00:00:00" }], "2026-10-28"), /Vigencia inválida/);
  });
  it("rechaza respuestas vacías o con otro formato", () => {
    rejected(() => parseDatosGovCo([], "2026-10-26"), /no devolvió/);
    rejected(() => parseDatosGovCo({ error: true }, "2026-10-26"), /no devolvió/);
    rejected(() => parseDatosGovCo([{ value: 1 }], "2026-10-26"), /formato/);
  });
});

describe("TRM de datos.gov.co: errores de red y límites (fetch simulado, sin red)", () => {
  const ctx = (fetchImpl: typeof fetch) => ({ today: "2026-10-26", fetchImpl, timeoutMs: 50, appToken: "token-de-prueba" });
  const response = (status: number, body: string) => new Response(body, { status, headers: { "Content-Type": "application/json" } });

  it("respuesta correcta y envío del token de aplicación", async () => {
    let headers: HeadersInit | undefined;
    const q = await datosGovCoTrm.fetchLatest(
      ctx(async (_url, init) => {
        headers = init?.headers;
        return response(200, JSON.stringify(SAMPLE));
      }),
    );
    expect(q.rate.toString()).toBe("3158.43");
    expect((headers as Record<string, string>)["X-App-Token"]).toBe("token-de-prueba");
  });
  it("límite del proveedor (429), error HTTP, JSON inválido y tiempo de espera", async () => {
    const run = (f: typeof fetch) => datosGovCoTrm.fetchLatest(ctx(f)).then(() => null, (e: ExchangeProviderError) => e);
    expect(await run(async () => response(429, "[]"))).toMatchObject({ kind: "error", message: expect.stringMatching(/429/) });
    expect(await run(async () => response(503, "[]"))).toMatchObject({ kind: "error", message: expect.stringMatching(/503/) });
    expect(await run(async () => response(200, "<html>"))).toMatchObject({ kind: "rejected" });
    const timeout = Object.assign(new Error("tiempo"), { name: "TimeoutError" });
    expect(await run(async () => Promise.reject(timeout))).toMatchObject({ kind: "error", message: expect.stringMatching(/no respondió/) });
    expect(await run(async () => Promise.reject(new TypeError("fetch failed")))).toMatchObject({ kind: "error", message: expect.stringMatching(/conectar/) });
  });
});
