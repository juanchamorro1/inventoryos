"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { initialState, type ActionState } from "@/lib/action-state";
import { SubmitButton } from "./form";
import { Alert, buttonClass, cx, inputClass } from "./ui";

type ServerAction = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Botón que abre un diálogo de confirmación antes de ejecutar una acción sensible.
 * Con requireReason pide un motivo obligatorio (queda en la auditoría y en el ledger).
 */
export function ConfirmAction({
  action,
  label,
  title,
  description,
  confirmLabel = "Confirmar",
  variant = "danger",
  requireReason = false,
  hidden = {},
  size = "md",
}: {
  action: ServerAction;
  label: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  variant?: "danger" | "primary" | "secondary";
  requireReason?: boolean;
  hidden?: Record<string, string>;
  size?: "sm" | "md";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(action, initialState);
  useEffect(() => {
    if (state.ok) ref.current?.close();
  }, [state]);
  return (
    <>
      <button type="button" className={buttonClass(variant === "danger" ? "secondary" : variant, size)} onClick={() => ref.current?.showModal()}>
        <span className={cx(variant === "danger" && "text-danger")}>{label}</span>
      </button>
      <dialog ref={ref} className="m-auto w-[min(92vw,460px)] rounded-xl border border-border bg-surface p-0 text-ink shadow-xl">
        <form action={formAction} className="space-y-4 p-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <div className="text-sm text-muted">{description}</div>}
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {requireReason && (
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="confirm-reason">
                Motivo
              </label>
              <textarea id="confirm-reason" name="reason" required minLength={3} maxLength={300} className={cx(inputClass, "h-auto min-h-20 py-2")} />
            </div>
          )}
          {state.error && <Alert>{state.error}</Alert>}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass("secondary")} onClick={() => ref.current?.close()}>
              Cancelar
            </button>
            <SubmitButton variant={variant === "secondary" ? "primary" : variant} pendingText="Procesando…">
              {confirmLabel}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
