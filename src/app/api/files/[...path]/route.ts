import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { buildTenantContext } from "@/server/modules/auth/service";
import { readStoredFile } from "@/server/storage";

// Sirve imágenes de productos solo a miembros de la empresa dueña del archivo.
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const session = await getSession();
  if (!session?.activeOrganizationId) return new NextResponse("No autorizado", { status: 401 });
  const [kind, organizationId, ...rest] = path;
  if (kind !== "products" || organizationId !== session.activeOrganizationId || rest.length !== 1) {
    return new NextResponse("No encontrado", { status: 404 });
  }
  try {
    await buildTenantContext(session.user.id, organizationId);
  } catch {
    return new NextResponse("No encontrado", { status: 404 });
  }
  const file = await readStoredFile(path.join("/"));
  if (!file) return new NextResponse("No encontrado", { status: 404 });
  return new NextResponse(new Uint8Array(file.data), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
