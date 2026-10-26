import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/server/modules/api-keys/service";
import { readProductImage } from "@/server/modules/catalog/images";
import { AppError } from "@/server/platform/errors";

// Foto de producto para integraciones: misma clave API (catalog:read) y solo fotos de la empresa de la clave (RLS).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await authenticateApiKey(req.headers.get("authorization"));
    const obj = await readProductImage(ctx, id);
    if (!obj) return NextResponse.json({ type: "about:blank", title: "Foto no encontrada", status: 404 }, { status: 404, headers: { "Content-Type": "application/problem+json" } });
    if (obj.kind === "redirect") return NextResponse.redirect(obj.url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
    return new NextResponse(new Uint8Array(obj.data), { headers: { "Content-Type": obj.contentType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    if (!(err instanceof AppError)) console.error("[api/v1/images] error inesperado", err);
    return NextResponse.json(
      { type: "about:blank", title: err instanceof AppError ? err.message : "Error interno", status },
      { status, headers: { "Content-Type": "application/problem+json", ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) } },
    );
  }
}
