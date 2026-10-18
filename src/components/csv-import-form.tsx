"use client";

import { useActionState } from "react";
import { importCsvAction } from "@/app/actions/catalog";
import { initialState, type ActionState } from "@/lib/action-state";
import type { ImportResult } from "@/server/modules/catalog/csv";
import { Alert, buttonClass } from "./ui";

export function CsvImportForm() {
  const [state, action, pending] = useActionState<ActionState<ImportResult>, FormData>(importCsvAction, initialState as ActionState<ImportResult>);
  const errors = state.data?.errors ?? [];
  return (
    <form action={action} className="space-y-4">
      <input type="file" name="file" accept=".csv,text/csv" className="block text-sm" aria-label="Archivo CSV" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="mode" value="validate" className={buttonClass("secondary")} disabled={pending}>
          {pending ? "Procesando…" : "Validar"}
        </button>
        <button type="submit" name="mode" value="apply" className={buttonClass("primary")} disabled={pending}>
          Importar
        </button>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}
      {errors.length > 0 && (
        <div className="max-h-80 overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Fila</th>
                <th className="px-3 py-2 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="num px-3 py-1.5">{e.row}</td>
                  <td className="px-3 py-1.5">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">Primero valida: no se guarda nada hasta que pulses «Importar».</p>
    </form>
  );
}
