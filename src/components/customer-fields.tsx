import { FieldError } from "./form";
import { Input, Label, Textarea } from "./ui";

type Customer = { name?: string; documentNumber?: string | null; email?: string | null; phone?: string | null; notes?: string | null };

export function CustomerFields({ c = {} }: { c?: Customer }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label htmlFor="name">Nombre</Label>
        <Input id="name" name="name" defaultValue={c.name} required maxLength={160} />
        <FieldError name="name" />
      </div>
      <div>
        <Label htmlFor="documentNumber">Documento</Label>
        <Input id="documentNumber" name="documentNumber" defaultValue={c.documentNumber ?? ""} maxLength={40} />
        <FieldError name="documentNumber" />
      </div>
      <div>
        <Label htmlFor="phone">Teléfono / WhatsApp</Label>
        <Input id="phone" name="phone" defaultValue={c.phone ?? ""} maxLength={40} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="email">Correo</Label>
        <Input id="email" name="email" type="email" defaultValue={c.email ?? ""} maxLength={254} />
        <FieldError name="email" />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="notes">Notas</Label>
        <Textarea id="notes" name="notes" defaultValue={c.notes ?? ""} maxLength={2000} />
      </div>
    </div>
  );
}
