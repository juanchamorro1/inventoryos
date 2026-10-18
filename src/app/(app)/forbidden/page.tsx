import { EmptyState, LinkButton } from "@/components/ui";

export const metadata = { title: "Sin permiso" };

export default function ForbiddenPage() {
  return (
    <EmptyState
      title="No tienes permiso para ver esta sección"
      description="Tu rol en esta empresa no incluye este acceso. Si lo necesitas, pide a un administrador que ajuste tu rol."
      action={<LinkButton href="/dashboard">Volver al inicio</LinkButton>}
    />
  );
}
