import { ReconcilePanel } from "@/components/reconcile-panel";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";

export const metadata = { title: "Revisar el inventario" };

export default async function ConsistencyPage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "inventory.read");
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Configuración" }} title="Revisar el inventario" />
      <Card>
        <div className="mb-4 space-y-2 text-sm text-muted">
          <p>Comprueba que la cantidad que muestra cada producto coincide con la suma de todas sus entradas y salidas registradas, y que el valor del inventario cuadra.</p>
          <p>Solo revisa: no cambia ningún dato. Úsalo si algo te parece raro o después de restaurar un respaldo.</p>
        </div>
        <ReconcilePanel />
      </Card>
    </>
  );
}
