"use client";

import { useActionState, useState } from "react";
import { createCompanyAction, reissueOwnerAction } from "@/app/actions/platform";
import { initialState, type ActionState } from "@/lib/action-state";
import { Alert, buttonClass, cx, inputClass } from "./ui";

type Result = ActionState<{ link: string; email: string }>;

function OneTimeLink({ link, email }: { link: string; email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Alert tone="warning">
      <p className="font-medium">Envía este enlace a {email} por un canal privado. Se muestra una sola vez, sirve una vez y vence en 72 horas.</p>
      <code className="mt-2 block break-all rounded bg-surface px-2 py-1 text-xs text-ink" data-testid="owner-link">
        {link}
      </code>
      <button type="button" className={cx(buttonClass("secondary", "sm"), "mt-2")} onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}>
        {copied ? "Copiado" : "Copiar enlace"}
      </button>
      <p className="mt-2 text-xs">Con ese enlace la persona crea su cuenta (o entra con la que ya tiene) y queda como propietaria de la empresa.</p>
    </Alert>
  );
}

export function CreateCompanyForm({ types, currencies }: { types: { value: string; label: string; description: string }[]; currencies: string[] }) {
  const [state, action, pending] = useActionState<Result, FormData>(createCompanyAction, initialState as Result);
  const err = (k: string) => state.fieldErrors?.[k]?.[0];
  return (
    <form action={action} className="space-y-4" noValidate>
      <div>
        <label htmlFor="company-name" className="mb-1 block text-sm font-medium">
          Nombre de la empresa
        </label>
        <input id="company-name" name="name" required maxLength={120} className={inputClass} />
        {err("name") && <p className="mt-1 text-xs text-danger">{err("name")}</p>}
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Tipo de negocio</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {types.map((t, i) => (
            <label key={t.value} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="radio" name="businessType" value={t.value} defaultChecked={i === 0} className="mt-0.5" />
              <span>
                <span className="block font-medium">{t.label}</span>
                <span className="block text-xs text-muted">{t.description}</span>
              </span>
            </label>
          ))}
        </div>
        {err("businessType") && <p className="mt-1 text-xs text-danger">{err("businessType")}</p>}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <div>
          <label htmlFor="owner-email" className="mb-1 block text-sm font-medium">
            Correo del dueño
          </label>
          <input id="owner-email" name="ownerEmail" type="email" required autoComplete="off" className={inputClass} />
          {err("ownerEmail") && <p className="mt-1 text-xs text-danger">{err("ownerEmail")}</p>}
        </div>
        <div>
          <label htmlFor="company-currency" className="mb-1 block text-sm font-medium">
            Moneda
          </label>
          <select id="company-currency" name="currency" defaultValue="COP" className={inputClass}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button type="submit" className={buttonClass("primary")} disabled={pending}>
        {pending ? "Creando…" : "Crear empresa"}
      </button>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.data && <OneTimeLink link={state.data.link} email={state.data.email} />}
    </form>
  );
}

export function ReissueOwnerButton({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<Result, FormData>(reissueOwnerAction, initialState as Result);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <button type="submit" className={buttonClass("secondary", "sm")} disabled={pending}>
        {pending ? "Generando…" : "Nuevo enlace para el dueño"}
      </button>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.data && <OneTimeLink link={state.data.link} email={state.data.email} />}
    </form>
  );
}
