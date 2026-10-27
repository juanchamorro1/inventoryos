import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { CartBadge } from "@/components/cart-badge";
import { storeConfig } from "@/lib/config";
import "./globals.css";

export function generateMetadata(): Metadata {
  const { storeName } = storeConfig();
  return { title: { default: storeName, template: `%s · ${storeName}` }, description: `Catálogo de ${storeName}. Pide por WhatsApp.` };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { storeName } = storeConfig();
  return (
    <html lang="es">
      <body className="min-h-screen">
        <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">{storeName}</Link>
            <CartBadge />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 pt-4 text-xs text-muted">Precios con IVA incluido. Catálogo actualizado desde nuestro inventario.</footer>
      </body>
    </html>
  );
}
