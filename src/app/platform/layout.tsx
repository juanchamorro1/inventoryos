import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { isPlatformAdmin } from "@/server/modules/platform/service";

export const metadata = { title: "Plataforma" };

// Herramientas de los operadores de InventoryOS. Quien no es administrador de plataforma recibe 404.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await isPlatformAdmin(session.user.id))) notFound();
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-lg font-semibold">InventoryOS · Plataforma</p>
        <Link href="/account" className="text-sm text-muted hover:text-ink">
          Volver a mi cuenta
        </Link>
      </div>
      {children}
    </main>
  );
}
