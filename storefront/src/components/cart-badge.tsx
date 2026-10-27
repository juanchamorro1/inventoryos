"use client";

import Link from "next/link";
import { useCart } from "./cart-store";

export function CartBadge() {
  const { count } = useCart();
  return (
    <Link href="/carrito" className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-primary">
      Carrito
      <span className="num inline-flex min-w-6 justify-center rounded-full bg-primary px-1.5 text-xs leading-5 text-white" aria-label={`${count} unidades`}>
        {count}
      </span>
    </Link>
  );
}
