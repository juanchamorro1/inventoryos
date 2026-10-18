import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function buttonClass(variant: Variant = "primary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap",
    size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
    variant === "primary" && "bg-primary text-white hover:bg-primary-strong",
    variant === "secondary" && "border border-border bg-surface text-ink hover:bg-bg",
    variant === "danger" && "bg-danger text-white hover:opacity-90",
    variant === "ghost" && "text-muted hover:bg-bg hover:text-ink",
  );
}

export function LinkButton({ variant = "primary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" | "md" }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...props} />;
}

export const inputClass =
  "block w-full rounded-lg border border-border bg-surface px-3 h-10 text-sm text-ink placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-bg";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputClass, "pr-8", props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(inputClass, "h-auto min-h-20 py-2", props.className)} />;
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-border bg-surface", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  help,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Explicación breve en lenguaje sencillo, desplegable con «¿Cómo funciona?». */
  help?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {back && (
            <Link href={back.href} className="mb-1 inline-block text-sm text-muted hover:text-ink">
              ← Volver a {back.label}
            </Link>
          )}
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-[15px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {help && (
        <details className="mt-3 rounded-lg border border-primary/20 bg-primary-soft/60 px-4 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-primary">¿Cómo funciona?</summary>
          <div className="mt-2 space-y-1.5 text-ink/80">{help}</div>
        </details>
      )}
    </div>
  );
}

/** Pestañas de una sección (enlaces). */
export function SectionTabs({ tabs, active }: { tabs: { href: string; label: string; count?: number }[]; active: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border" aria-label="Secciones">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === active ? "page" : undefined}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[15px]",
            t.href === active ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="ml-1.5 rounded-full bg-warning-soft px-1.5 text-xs text-warning">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Texto de ayuda bajo un campo. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-muted">{children}</p>;
}

const badgeTones = {
  neutral: "bg-bg text-muted border-border",
  primary: "bg-primary-soft text-primary border-primary/20",
  success: "bg-success-soft text-success border-success/20",
  warning: "bg-warning-soft text-warning border-warning/20",
  danger: "bg-danger-soft text-danger border-danger/20",
} as const;
export type Tone = keyof typeof badgeTones;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", badgeTones[tone])}>{children}</span>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, align = "left", className }: { children?: ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <th
      className={cx(
        "border-b border-border bg-bg/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className }: { children?: ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <td className={cx("border-b border-border px-4 py-3 align-middle last:border-b-0", align === "right" ? "text-right num" : align === "center" ? "text-center" : "", className)}>
      {children}
    </td>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "danger", children }: { tone?: "danger" | "success" | "warning" | "primary"; children: ReactNode }) {
  const tones = {
    danger: "border-danger/30 bg-danger-soft text-danger",
    success: "border-success/30 bg-success-soft text-success",
    warning: "border-warning/30 bg-warning-soft text-warning",
    primary: "border-primary/30 bg-primary-soft text-primary",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-lg border px-4 py-3 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={cx("num mt-1 text-2xl font-semibold", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Label({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {children}
      {hint && <span className="ml-1 font-normal text-muted">({hint})</span>}
    </label>
  );
}

/** Paginación con enlaces GET que conservan los filtros actuales. */
export function Pagination({ page, pageSize, total, basePath, params }: { page: number; pageSize: number; total: number; basePath: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted" aria-label="Paginación">
      <span>
        {from}–{to} de {total}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={buttonClass("secondary", "sm")} href={href(page - 1)}>
            Anterior
          </Link>
        ) : (
          <span className={cx(buttonClass("secondary", "sm"), "pointer-events-none opacity-50")}>Anterior</span>
        )}
        <span className="flex items-center px-2">
          Página {page} de {pages}
        </span>
        {page < pages ? (
          <Link className={buttonClass("secondary", "sm")} href={href(page + 1)}>
            Siguiente
          </Link>
        ) : (
          <span className={cx(buttonClass("secondary", "sm"), "pointer-events-none opacity-50")}>Siguiente</span>
        )}
      </div>
    </nav>
  );
}

export function FilterBar({ children, action, clear }: { children: ReactNode; action: string; clear?: boolean }) {
  return (
    <form action={action} method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3">
      {children}
      <button type="submit" className={buttonClass("primary")}>
        Buscar
      </button>
      {clear && (
        <Link href={action} className={buttonClass("ghost")}>
          Limpiar
        </Link>
      )}
    </form>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs uppercase tracking-wide text-muted">{i.label}</dt>
          <dd className="mt-0.5">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
