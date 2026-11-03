import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { getSession } from "@/server/auth/session";
import { isPlatformAdmin } from "@/server/modules/platform/service";

export const metadata = { title: "Plataforma" };

// Herramientas de los operadores de InventoryOS. Quien no es administrador de plataforma recibe 404.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await isPlatformAdmin(session.user.id))) notFound();
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-lg font-semibold">InventoryOS · Plataforma</p>
        <div className="flex gap-4 text-sm">
          <Link href="/dashboard" className="text-muted hover:text-ink">
            Ir a mi empresa
          </Link>
          <Link href="/account" className="text-muted hover:text-ink">
            Mi cuenta
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="text-muted hover:text-ink">
              Salir
            </button>
          </form>
        </div>
      </div>
      {children}
    </main>
  );
}
