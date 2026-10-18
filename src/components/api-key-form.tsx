"use client";

import { useActionState } from "react";
import { createApiKeyAction } from "@/app/actions/settings";
import { initialState, type ActionState } from "@/lib/action-state";
import { Alert, buttonClass, inputClass } from "./ui";

export function ApiKeyForm() {
  const [state, action, pending] = useActionState<ActionState<{ key: string }>, FormData>(createApiKeyAction, initialState as ActionState<{ key: string }>);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="kname" className="mb-1 block text-sm font-medium">
          Nombre
        </label>
        <input id="kname" name="name" className={inputClass} placeholder="Asistente WhatsApp" required maxLength={80} />
      </div>
      <fieldset className="space-y-1 text-sm">
        <legend className="mb-1 font-medium">Permisos (solo lectura)</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="scopes" value="catalog:read" defaultChecked /> Catálogo y precios
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="scopes" value="inventory:read" defaultChecked /> Disponibilidad por bodega
        </label>
      </fieldset>
      <button type="submit" className={buttonClass("primary")} disabled={pending}>
        {pending ? "Creando…" : "Crear clave"}
      </button>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.data?.key && (
        <Alert tone="warning">
          <p className="font-medium">Copia la clave ahora: no se volverá a mostrar.</p>
          <code className="mt-2 block break-all rounded bg-surface px-2 py-1 text-xs text-ink" data-testid="new-api-key">
            {state.data.key}
          </code>
        </Alert>
      )}
    </form>
  );
}
