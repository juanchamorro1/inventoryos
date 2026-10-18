import { EmptyState, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <EmptyState
      title="No encontramos lo que buscas"
      description="El registro no existe o pertenece a otra empresa."
      action={<LinkButton href="/dashboard">Volver al inicio</LinkButton>}
    />
  );
}
