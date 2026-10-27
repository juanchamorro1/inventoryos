import { isPublishedImage } from "@/lib/catalog";
import { storeConfig } from "@/lib/config";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new Response("No encontrada", { status: 404 });

// Proxy de fotos: el navegador nunca ve la clave API. Solo fotos de productos publicados en el catálogo.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  try {
    if (!(await isPublishedImage(id))) return notFound();
    const { apiUrl, apiKey } = storeConfig();
    const res = await fetch(`${apiUrl}/api/v1/images/${id}`, { headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return notFound();
    return new Response(res.body, {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=300, s-maxage=3600", "X-Content-Type-Options": "nosniff" },
    });
  } catch (err) {
    console.error("[tienda] foto no disponible", err);
    return notFound();
  }
}
