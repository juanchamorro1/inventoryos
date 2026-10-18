"use client";

import { EmptyState, buttonClass } from "@/components/ui";

export default function AppError({ reset, error }: { reset: () => void; error: Error & { digest?: string } }) {
  return (
    <EmptyState
      title="Algo salió mal al cargar esta página"
      description={`Inténtalo de nuevo. Si el problema persiste, comparte este código con soporte: ${error.digest ?? "sin código"}.`}
      action={
        <button type="button" className={buttonClass("primary")} onClick={reset}>
          Reintentar
        </button>
      }
    />
  );
}
