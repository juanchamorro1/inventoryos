import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { buildTenantContext } from "@/server/modules/auth/service";
import { readProductImage } from "@/server/modules/catalog/images";

// Fotos de productos para la aplicación: solo miembros activos de la empresa dueña (la fila se busca con RLS).
// Con almacenamiento S3 responde con una redirección a una URL prefirmada de corta duración.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session?.activeOrganizationId) return new NextResponse("No autorizado", { status: 401 });
  try {
    const ctx = await buildTenantContext(session.user.id, session.activeOrganizationId);
    const obj = await readProductImage(ctx, id);
    if (!obj) return new NextResponse("No encontrado", { status: 404 });
    if (obj.kind === "redirect") return NextResponse.redirect(obj.url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
    return new NextResponse(new Uint8Array(obj.data), {
      headers: { "Content-Type": obj.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new NextResponse("No encontrado", { status: 404 });
  }
}
