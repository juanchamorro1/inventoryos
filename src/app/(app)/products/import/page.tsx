import { CsvImportForm } from "@/components/csv-import-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { CSV_COLUMNS } from "@/server/modules/catalog/csv";

export const metadata = { title: "Importar productos" };

export default async function ImportPage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "catalog.write");
  return (
    <>
      <PageHeader title="Importar productos desde CSV" back={{ href: "/products", label: "Productos" }} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card title="Archivo">
          <CsvImportForm />
        </Card>
        <Card title="Formato">
          <div className="space-y-3 text-sm">
            <p>
              Archivo CSV en UTF-8 con encabezados, separado por comas o punto y coma. Cada fila es una variante; las filas con el mismo <code>producto</code> se
              agrupan.
            </p>
            <p className="text-muted">Columnas reconocidas:</p>
            <p className="font-mono text-xs">{CSV_COLUMNS.filter((c) => c !== "existencias").join(", ")}</p>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>Obligatorias: producto y sku.</li>
              <li>Si el SKU ya existe, la fila actualiza ese producto.</li>
              <li>opciones: Color=Negro;Memoria=128GB</li>
              <li>impuesto: nombre (IVA 19%) o tarifa (19). Vacío = impuesto predeterminado.</li>
              <li>Decimales con punto: 1599000.50</li>
              <li>La importación no modifica existencias: registra el inventario inicial con una entrada.</li>
              <li>Si alguna fila tiene errores no se aplica ningún cambio.</li>
            </ul>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="inline-block text-primary hover:underline" href="/products/export">
              Descargar el catálogo actual como plantilla
            </a>
          </div>
        </Card>
      </div>
    </>
  );
}
