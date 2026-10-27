export function CatalogUnavailable() {
  return (
    <div className="rounded-xl border border-border bg-surface p-8 text-center">
      <h1 className="text-lg font-semibold">El catálogo no está disponible en este momento</h1>
      <p className="mt-2 text-muted">Vuelve a intentarlo en unos minutos.</p>
    </div>
  );
}
