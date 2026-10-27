import Link from "next/link";
import { Icon, type IconName } from "./icons";
import { cx } from "./ui";

// Botón grande con ícono, título y una línea de ayuda: para las acciones principales de una pantalla.
export function BigAction({
  href,
  icon,
  title,
  text,
  primary = false,
  tone,
  download = false,
}: {
  href: string;
  icon: IconName;
  title: string;
  text?: string;
  primary?: boolean;
  tone?: "danger";
  /** Descarga desde un route handler (no es una página). */
  download?: boolean;
}) {
  const className = cx(
    "group flex min-h-20 items-center gap-4 rounded-xl border p-4 transition-colors",
    tone === "danger"
      ? "border-danger/40 bg-danger/5 hover:border-danger"
      : primary
        ? "border-primary bg-primary text-white hover:bg-primary/90"
        : "border-border bg-surface hover:border-primary",
  );
  const body = (
    <>
      <span className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-lg", primary ? "bg-white/15" : tone === "danger" ? "bg-danger/10 text-danger" : "bg-bg text-primary")}>
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <span>
        <span className="block text-base font-semibold">{title}</span>
        {text && <span className={cx("block text-sm", primary ? "text-white/85" : "text-muted")}>{text}</span>}
      </span>
    </>
  );
  return download ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}
