"use client";

/** Envía el formulario de filtros al cambiar un select o casilla (sin JS, queda el botón «Aplicar»). */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

export function AutoSubmitCheckbox(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
