"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "./icons";
import { cx } from "./ui";

export type NavItem = { href: string; label: string; icon: IconName; match?: string[] };

export function Sidebar({
  items,
  orgName,
  footer,
  primary,
}: {
  items: NavItem[];
  orgName: string;
  footer: React.ReactNode;
  primary?: { href: string; label: string };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // La opción activa es la de prefijo más largo que coincide con la ruta actual.
  const activeHref = items
    .flatMap((i) => [i.href, ...(i.match ?? [])].map((p) => ({ href: i.href, p })))
    .filter(({ p }) => pathname === p || pathname.startsWith(`${p}/`))
    .sort((a, b) => b.p.length - a.p.length)[0]?.href;
  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3 lg:hidden">
        <Link href="/dashboard" className="font-semibold">
          InventoryOS
        </Link>
        <div className="flex gap-2">
          {primary && (
            <Link href={primary.href} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white">
              {primary.label}
            </Link>
          )}
          <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" aria-expanded={open} aria-controls="app-sidebar" onClick={() => setOpen((v) => !v)}>
            {open ? "Cerrar" : "Menú"}
          </button>
        </div>
      </div>
      <aside
        id="app-sidebar"
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="border-b border-border px-5 py-4">
          <Link href="/dashboard" className="flex items-center gap-2" onClick={() => setOpen(false)}>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-white">I</span>
            <span className="font-semibold">InventoryOS</span>
          </Link>
          <p className="mt-2 truncate text-sm text-muted" title={orgName}>
            {orgName}
          </p>
        </div>
        {primary && (
          <div className="px-3 pt-3">
            <Link
              href={primary.href}
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 font-medium text-white hover:bg-primary-strong"
            >
              <Icon name="cart" /> {primary.label}
            </Link>
          </div>
        )}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label="Principal">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px]",
                  active ? "bg-primary-soft font-medium text-primary" : "text-ink/80 hover:bg-bg hover:text-ink",
                )}
              >
                <Icon name={item.icon} className="h-5 w-5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">{footer}</div>
      </aside>
      {open && <button type="button" aria-label="Cerrar menú" className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}
