"use client";

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { initialState, type ActionState } from "@/lib/action-state";
import { Alert, buttonClass, cx } from "./ui";

type ServerAction = (prev: ActionState, form: FormData) => Promise<ActionState>;

const FormStateContext = createContext<ActionState>(initialState);

/**
 * Formulario conectado a una server action. Muestra el error general y expone los errores por campo
 * a <FieldError name="..."/>. Con resetOnSuccess limpia los campos tras guardar.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  successMessage,
}: {
  action: ServerAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
}) {
  const [state, formAction] = useActionState(action, initialState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <FormStateContext.Provider value={state}>
      <form ref={ref} action={formAction} className={cx("space-y-4", className)} noValidate>
        {state.error && <Alert>{state.error}</Alert>}
        {state.ok && (state.message || successMessage) && <Alert tone="success">{state.message ?? successMessage}</Alert>}
        {children}
      </form>
    </FormStateContext.Provider>
  );
}

export function useFormState() {
  return useContext(FormStateContext);
}

export function FieldError({ name }: { name: string }) {
  const state = useContext(FormStateContext);
  const errors = state.fieldErrors?.[name];
  if (!errors?.length) return null;
  return <p className="mt-1 text-xs text-danger">{errors[0]}</p>;
}

export function SubmitButton({ children, variant = "primary", pendingText = "Guardando…", className }: { children: ReactNode; variant?: "primary" | "secondary" | "danger"; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cx(buttonClass(variant), className)} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
