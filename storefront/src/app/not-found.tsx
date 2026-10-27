import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rounded-xl border border-border bg-surface p-8 text-center">
      <h1 className="text-lg font-semibold">Este producto ya no está disponible</h1>
      <Link href="/" className="mt-4 inline-block font-medium text-primary underline">Ver el catálogo</Link>
    </div>
  );
}
