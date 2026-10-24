"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createInvitationAction } from "@/app/actions/settings";
import { initialState, type ActionState } from "@/lib/action-state";
import { Alert, buttonClass, cx, inputClass } from "./ui";

type Result = ActionState<{ link: string; email: string }>;

export function InviteForm({ roles, hours }: { roles: { value: string; label: string }[]; hours: number }) {
  const [state, action, pending] = useActionState<Result, FormData>(createInvitationAction, initialState as Result);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  const copy = async () => {
    if (!state.data) return;
    await navigator.clipboard.writeText(state.data.link).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <form ref={ref} action={action} className="space-y-3" noValidate onSubmit={() => setCopied(false)}>
      <div>
        <label htmlFor="iemail" className="mb-1 block text-sm font-medium">
          Correo de la persona
        </label>
        <input id="iemail" name="email" type="email" className={inputClass} required autoComplete="off" />
        {state.fieldErrors?.email && <p className="mt-1 text-xs text-danger">{state.fieldErrors.email[0]}</p>}
      </div>
      <div>
        <label htmlFor="irole" className="mb-1 block text-sm font-medium">
          Rol
        </label>
        <select id="irole" name="role" defaultValue="staff" className={inputClass}>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className={buttonClass("primary")} disabled={pending}>
        {pending ? "Creando…" : "Crear invitación"}
      </button>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.data && (
        <Alert tone="warning">
          <p className="font-medium">Envía este enlace a {state.data.email} por un canal privado. Solo se muestra ahora y vence en {hours} horas.</p>
          <code className="mt-2 block break-all rounded bg-surface px-2 py-1 text-xs text-ink" data-testid="invite-link">
            {state.data.link}
          </code>
          <button type="button" onClick={copy} className={cx(buttonClass("secondary", "sm"), "mt-2")}>
            {copied ? "Copiado" : "Copiar enlace"}
          </button>
          <p className="mt-2 text-xs">La persona elegirá su propia contraseña. Si ya tiene cuenta, deberá iniciar sesión y aceptar.</p>
        </Alert>
      )}
    </form>
  );
}
