import { FieldError } from "./form";
import { Input, Label, Textarea } from "./ui";

type Supplier = { name?: string; taxId?: string | null; contactName?: string | null; email?: string | null; phone?: string | null; address?: string | null; notes?: string | null };

export function SupplierFields({ s = {} }: { s?: Supplier }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label htmlFor="name">Razón social / nombre</Label>
        <Input id="name" name="name" defaultValue={s.name} required maxLength={160} />
        <FieldError name="name" />
      </div>
      <div>
        <Label htmlFor="taxId">NIT / identificación</Label>
        <Input id="taxId" name="taxId" defaultValue={s.taxId ?? ""} maxLength={40} />
        <FieldError name="taxId" />
      </div>
      <div>
        <Label htmlFor="contactName">Contacto</Label>
        <Input id="contactName" name="contactName" defaultValue={s.contactName ?? ""} maxLength={120} />
      </div>
      <div>
        <Label htmlFor="email">Correo</Label>
        <Input id="email" name="email" type="email" defaultValue={s.email ?? ""} maxLength={254} />
        <FieldError name="email" />
      </div>
      <div>
        <Label htmlFor="phone">Teléfono</Label>
        <Input id="phone" name="phone" defaultValue={s.phone ?? ""} maxLength={40} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="address">Dirección</Label>
        <Input id="address" name="address" defaultValue={s.address ?? ""} maxLength={300} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="notes">Notas</Label>
        <Textarea id="notes" name="notes" defaultValue={s.notes ?? ""} maxLength={2000} />
      </div>
    </div>
  );
}
