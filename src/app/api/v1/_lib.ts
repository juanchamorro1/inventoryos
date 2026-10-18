import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/server/modules/api-keys/service";
import type { TenantContext } from "@/server/platform/context";
import { AppError } from "@/server/platform/errors";

/** Envoltorio común de la API v1: autenticación por clave, errores en formato RFC 9457 (problem+json). */
export async function apiHandler(req: Request, fn: (ctx: TenantContext) => Promise<unknown>) {
  try {
    const ctx = await authenticateApiKey(req.headers.get("authorization"));
    const body = await fn(ctx);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(
        { type: `https://inventoryos.local/errors/${err.code}`, title: err.message, status: err.status },
        { status: err.status, headers: { "Content-Type": "application/problem+json", ...(err.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) } },
      );
    }
    console.error("[api/v1] error inesperado", err);
    return NextResponse.json({ type: "about:blank", title: "Error interno", status: 500 }, { status: 500, headers: { "Content-Type": "application/problem+json" } });
  }
}
