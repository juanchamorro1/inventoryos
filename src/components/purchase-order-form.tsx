import { ActionForm, FieldError, SubmitButton } from "./form";
import { LineItemsEditor, type InitialLine } from "./line-items-editor";
import { Input, Label, Select, Textarea } from "./ui";
import type { ActionState } from "@/lib/action-state";

export function PurchaseOrderForm({
  action,
  suppliers,
  warehouses,
  currency,
  initial,
  submitLabel,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  suppliers: { id: string; name: string }[];
  warehouses: { id: string; name: string; isDefault: boolean }[];
  currency: string;
  initial: { id?: string; supplierId?: string; warehouseId?: string; expectedDate?: string | null; notes?: string | null; lines?: InitialLine[] };
  submitLabel: string;
}) {
  return (
    <ActionForm action={action}>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="supplierId">Proveedor</Label>
          <Select id="supplierId" name="supplierId" defaultValue={initial.supplierId ?? ""}>
            <option value="" disabled>
              Selecciona…
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <FieldError name="supplierId" />
        </div>
        <div>
          <Label htmlFor="warehouseId">¿A qué bodega llega?</Label>
          <Select id="warehouseId" name="warehouseId" defaultValue={initial.warehouseId ?? warehouses.find((w) => w.isDefault)?.id}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <FieldError name="warehouseId" />
        </div>
        <div>
          <Label htmlFor="expectedDate">¿Cuándo llega? (opcional)</Label>
          <Input id="expectedDate" name="expectedDate" type="date" defaultValue={initial.expectedDate ?? ""} />
          <FieldError name="expectedDate" />
        </div>
      </div>
      <div>
        <Label htmlFor="notes">Comentario (opcional)</Label>
        <Textarea id="notes" name="notes" defaultValue={initial.notes ?? ""} maxLength={2000} />
      </div>
      <div>
        <Label>Productos</Label>
        <LineItemsEditor mode="purchase" currency={currency} initial={initial.lines} />
        <FieldError name="lines" />
      </div>
      <p className="text-xs text-muted">Escribe el costo por unidad sin IVA, tal como aparece en la cotización del proveedor.</p>
      <div className="flex justify-end">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
