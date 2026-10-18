import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { buildTenantContext } from "@/server/modules/auth/service";
import { readStoredFile } from "@/server/storage";

// Sirve imágenes de productos solo a miembros activos de la empresa dueña del archivo
// (la consulta corre con el contexto de la empresa activa: RLS impide leer archivos ajenos).
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const session = await getSession();
  if (!session?.activeOrganizationId) return new NextResponse("No autorizado", { status: 401 });
  try {
    const ctx = await buildTenantContext(session.user.id, session.activeOrganizationId);
    const file = await readStoredFile(ctx, path.join("/"));
    if (!file) return new NextResponse("No encontrado", { status: 404 });
    return new NextResponse(new Uint8Array(file.data), {
      headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new NextResponse("No encontrado", { status: 404 });
  }
}
