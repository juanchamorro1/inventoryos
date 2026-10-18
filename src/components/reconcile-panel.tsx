"use client";

import { useActionState } from "react";
import { reconcileAction } from "@/app/actions/inventory";
import { initialState, type ActionState } from "@/lib/action-state";
import type { ReconciliationIssue } from "@/server/modules/inventory/service";
import { Alert, buttonClass } from "./ui";

type Result = { checked: number; issues: ReconciliationIssue[] };

export function ReconcilePanel() {
  const [state, action, pending] = useActionState<ActionState<Result>, FormData>(reconcileAction, initialState as ActionState<Result>);
  return (
    <form action={action} className="space-y-4">
      <button type="submit" className={buttonClass("primary")} disabled={pending}>
        {pending ? "Verificando…" : "Ejecutar verificación"}
      </button>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.data && state.data.issues.length === 0 && (
        <Alert tone="success">Sin diferencias: todo cuadra ({state.data.checked} cantidades revisadas).</Alert>
      )}
      {state.ok && state.data && state.data.issues.length > 0 && (
        <>
          <Alert>Se encontraron {state.data.issues.length} diferencias. Contacta a soporte técnico: no corrijas saldos manualmente.</Alert>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted">
              <tr>
                <th className="text-left">Tipo</th>
                <th className="text-left">SKU</th>
                <th className="text-left">Dónde</th>
                <th className="text-right">Esperado</th>
                <th className="text-right">Actual</th>
              </tr>
            </thead>
            <tbody>
              {state.data.issues.map((i, n) => (
                <tr key={n} className="border-t border-border">
                  <td>{i.kind}</td>
                  <td>{i.sku}</td>
                  <td>{i.where}</td>
                  <td className="num text-right">{i.expected}</td>
                  <td className="num text-right">{i.actual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </form>
  );
}
