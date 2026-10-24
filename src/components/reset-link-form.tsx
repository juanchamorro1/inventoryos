"use client";

import { useActionState, useState } from "react";
import { issueResetLinkAction } from "@/app/actions/platform";
import { initialState, type ActionState } from "@/lib/action-state";
import { Alert, buttonClass, cx } from "./ui";

type Result = ActionState<{ link: string }>;

export function ResetLinkForm({ userId, hours }: { userId: string; hours: number }) {
  const [state, action, pending] = useActionState<Result, FormData>(issueResetLinkAction, initialState as Result);
  const [copied, setCopied] = useState(false);
  const link = state.ok ? state.data?.link : undefined;
  return (
    <form action={action} className="space-y-3" onSubmit={() => setCopied(false)}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" className={buttonClass("secondary")} disabled={pending}>
        {pending ? "Generando…" : "Generar enlace para restablecer la contraseña"}
      </button>
      {state.error && <Alert>{state.error}</Alert>}
      {link && (
        <Alert tone="warning">
          <p className="font-medium">Entrégalo solo a la persona, después de verificar su identidad. Se muestra una vez, sirve una vez y vence en {hours} horas.</p>
          <code className="mt-2 block break-all rounded bg-surface px-2 py-1 text-xs text-ink" data-testid="reset-link">
            {link}
          </code>
          <button
            type="button"
            className={cx(buttonClass("secondary", "sm"), "mt-2")}
            onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}
          >
            {copied ? "Copiado" : "Copiar enlace"}
          </button>
        </Alert>
      )}
    </form>
  );
}
