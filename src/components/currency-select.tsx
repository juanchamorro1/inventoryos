import { Select } from "./ui";

// Monedas más usadas en la región. El valor es el código ISO 4217 que guarda el sistema.
export const CURRENCIES = [
  { code: "COP", label: "Peso colombiano (COP)" },
  { code: "USD", label: "Dólar estadounidense (USD)" },
  { code: "MXN", label: "Peso mexicano (MXN)" },
  { code: "PEN", label: "Sol peruano (PEN)" },
  { code: "CLP", label: "Peso chileno (CLP)" },
  { code: "ARS", label: "Peso argentino (ARS)" },
  { code: "BRL", label: "Real brasileño (BRL)" },
  { code: "BOB", label: "Boliviano (BOB)" },
  { code: "PYG", label: "Guaraní paraguayo (PYG)" },
  { code: "UYU", label: "Peso uruguayo (UYU)" },
  { code: "VES", label: "Bolívar venezolano (VES)" },
  { code: "GTQ", label: "Quetzal guatemalteco (GTQ)" },
  { code: "HNL", label: "Lempira hondureño (HNL)" },
  { code: "NIO", label: "Córdoba nicaragüense (NIO)" },
  { code: "CRC", label: "Colón costarricense (CRC)" },
  { code: "PAB", label: "Balboa panameño (PAB)" },
  { code: "DOP", label: "Peso dominicano (DOP)" },
  { code: "EUR", label: "Euro (EUR)" },
] as const;

export function CurrencySelect({ id = "currency", name = "currency", defaultValue = "COP" }: { id?: string; name?: string; defaultValue?: string }) {
  // Si la empresa ya usa una moneda que no está en la lista, se conserva como opción.
  const known = CURRENCIES.some((c) => c.code === defaultValue);
  return (
    <Select id={id} name={name} defaultValue={defaultValue}>
      {!known && <option value={defaultValue}>{defaultValue}</option>}
      {CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.label}
        </option>
      ))}
    </Select>
  );
}
