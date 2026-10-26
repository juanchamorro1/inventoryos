"use client";

import Papa from "papaparse";
import { useState } from "react";
import { importChunkAction } from "@/app/actions/catalog";
import type { ImportRowError } from "@/server/modules/catalog/csv";
import { Alert, buttonClass } from "./ui";

// Importación por partes: el archivo se lee en el navegador y se envía en lotes de 100 filas.
// 1) Validar: cada lote se revisa contra la base SIN guardar. 2) Importar: cada lote se aplica en su propia
// transacción. Reaplicar lotes ya importados es seguro (los SKU existentes se actualizan, no se duplican).

const CHUNK = 100;
const MAX_ROWS = 5000;
const MAX_BYTES = 5 * 1024 * 1024;

type Phase = "idle" | "validating" | "valid" | "importing" | "done";

export function CsvImportForm() {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errors, setErrors] = useState<ImportRowError[]>([]);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [acceptBelowCost, setAcceptBelowCost] = useState(false);
  const busy = phase === "validating" || phase === "importing";

  async function onFile(file: File | undefined) {
    setRows([]);
    setErrors([]);
    setMessage(null);
    setPhase("idle");
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_BYTES) return setMessage({ tone: "danger", text: "El archivo supera 5 MB. Divídelo en varios archivos." });
    const text = (await file.text()).replace(/^﻿/, "");
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase(), delimitersToGuess: [",", ";", "\t"] });
    const found: ImportRowError[] = parsed.errors.slice(0, 50).map((e) => ({ row: (e.row ?? 0) + 2, message: `Formato CSV: ${e.message}` }));
    const headers = parsed.meta.fields ?? [];
    for (const h of ["producto", "sku"]) if (!headers.includes(h)) found.push({ row: 1, message: `Falta la columna obligatoria "${h}".` });
    if (parsed.data.length === 0) found.push({ row: 1, message: "El archivo no tiene filas de datos." });
    if (parsed.data.length > MAX_ROWS) found.push({ row: 1, message: `Máximo ${MAX_ROWS} filas por archivo.` });
    // Duplicados en TODO el archivo (cada lote del servidor solo ve sus propias filas).
    const sku = new Map<string, number>();
    const barcode = new Map<string, number>();
    parsed.data.forEach((r, i) => {
      const line = i + 2;
      const s = (r.sku ?? "").trim().toLowerCase();
      if (s) {
        if (sku.has(s)) found.push({ row: line, message: `sku repetido (ya aparece en la fila ${sku.get(s)}).` });
        else sku.set(s, line);
      }
      const b = (r.codigo_barras ?? "").trim();
      if (b) {
        if (barcode.has(b)) found.push({ row: line, message: `codigo_barras repetido (fila ${barcode.get(b)}).` });
        else barcode.set(b, line);
      }
    });
    setErrors(found);
    if (found.length) return setMessage({ tone: "danger", text: `Se encontraron ${found.length} problemas en el archivo. Corrígelos y vuelve a elegirlo.` });
    setRows(parsed.data);
    setMessage({ tone: "warning", text: `${parsed.data.length} filas leídas. Pulsa «Validar» para revisarlas antes de importar.` });
  }

  async function runChunks(dryRun: boolean) {
    setErrors([]);
    setMessage(null);
    setPhase(dryRun ? "validating" : "importing");
    const total = Math.ceil(rows.length / CHUNK);
    setProgress({ done: 0, total });
    const found: ImportRowError[] = [];
    let created = 0;
    let updated = 0;
    for (let i = 0; i < total; i++) {
      const slice = rows.slice(i * CHUNK, (i + 1) * CHUNK);
      const res = await importChunkAction({ rows: slice, firstLine: i * CHUNK + 2, dryRun, acceptBelowCost });
      if (!res.ok) {
        found.push({ row: i * CHUNK + 2, message: res.error });
      } else {
        found.push(...res.result.errors);
        created += res.result.created;
        updated += res.result.updated;
      }
      setProgress({ done: i + 1, total });
      if (!dryRun && found.length) {
        setErrors(found);
        setPhase("valid");
        return setMessage({
          tone: "danger",
          text: `Se importaron ${i} de ${total} lotes (${i * CHUNK} filas). El lote ${i + 1} tuvo errores y no se aplicó. Corrige el archivo y vuelve a importarlo: los lotes ya importados se actualizan sin duplicarse.`,
        });
      }
    }
    setErrors(found);
    if (dryRun) {
      setPhase(found.length ? "idle" : "valid");
      setMessage(found.length ? { tone: "danger", text: `Se encontraron ${found.length} errores. No se guardó nada.` } : { tone: "success", text: `Validación correcta: ${rows.length} filas listas para importar.` });
    } else {
      setPhase("done");
      setMessage({ tone: "success", text: `Importación terminada: ${created} productos nuevos y ${updated} actualizados.` });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="csv-file" className="mb-1 block text-sm font-medium">
          Archivo CSV
        </label>
        <input id="csv-file" type="file" accept=".csv,text/csv" className="block text-sm" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
        {fileName && <p className="mt-1 text-xs text-muted">{fileName}</p>}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={acceptBelowCost} onChange={(e) => setAcceptBelowCost(e.target.checked)} disabled={busy} />
        <span>Acepto importar precios manuales por debajo del costo (si no, esas filas se marcan como error).</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass("secondary")} disabled={!rows.length || busy} onClick={() => runChunks(true)}>
          {phase === "validating" ? "Validando…" : "Validar"}
        </button>
        <button type="button" className={buttonClass("primary")} disabled={phase !== "valid" || busy} onClick={() => runChunks(false)}>
          {phase === "importing" ? "Importando…" : `Importar ${rows.length || ""} filas`}
        </button>
      </div>
      {progress.total > 0 && busy && (
        <div role="status" aria-live="polite" className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
          <p className="text-xs text-muted">
            Lote {progress.done} de {progress.total}
          </p>
        </div>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {errors.length > 0 && (
        <div className="max-h-80 overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Errores por fila</caption>
            <thead className="bg-bg text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Fila</th>
                <th className="px-3 py-2 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {errors.slice(0, 500).map((e, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="num px-3 py-1.5">{e.row}</td>
                  <td className="px-3 py-1.5">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">Primero valida: no se guarda nada hasta que pulses «Importar». El archivo se envía en lotes de {CHUNK} filas.</p>
    </div>
  );
}
