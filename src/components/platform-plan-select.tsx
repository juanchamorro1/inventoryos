"use client";

import { useActionState } from "react";
import { setCompanyPlanAction } from "@/app/actions/platform";
import { initialState, type ActionState } from "@/lib/action-state";
import { Alert, cx, inputClass } from "./ui";

/** Plan de una empresa: se guarda al elegirlo. */
export function PlanSelect({ organizationId, companyName, plan, options }: { organizationId: string; companyName: string; plan: string; options: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setCompanyPlanAction, initialState);
  return (
    <form action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <select
        name="plan"
        defaultValue={plan}
        disabled={pending}
        aria-label={`Plan de ${companyName}`}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={cx(inputClass, "w-36! py-1 text-sm")}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {state.error && <Alert>{state.error}</Alert>}
    </form>
  );
}
