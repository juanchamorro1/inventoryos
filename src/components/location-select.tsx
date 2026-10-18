import { Select } from "./ui";

export type LocationOption = { id: string; code: string; name: string; warehouseId: string; warehouseName: string; isDefault: boolean; warehouseIsDefault: boolean };

/** Nombre legible: solo la bodega si tiene una única ubicación; si no, «Bodega · Ubicación». */
export function locationLabel(l: LocationOption, all: LocationOption[]) {
  const siblings = all.filter((x) => x.warehouseId === l.warehouseId).length;
  return siblings > 1 ? `${l.warehouseName} · ${l.name}` : l.warehouseName;
}

/**
 * Selector de lugar (bodega/ubicación). Si solo hay un lugar posible no muestra un desplegable:
 * lo indica como texto y lo envía oculto.
 */
export function LocationSelect({ name, id, locations, defaultValue, warehouseId }: { name: string; id?: string; locations: LocationOption[]; defaultValue?: string; warehouseId?: string }) {
  const options = warehouseId ? locations.filter((l) => l.warehouseId === warehouseId) : locations;
  const fallback = options.find((l) => l.isDefault && (warehouseId || l.warehouseIsDefault))?.id ?? options[0]?.id;
  if (options.length === 1) {
    return (
      <>
        <input type="hidden" name={name} id={id ?? name} value={options[0]!.id} />
        <p className="flex h-10 items-center rounded-lg border border-border bg-bg px-3 text-sm">{locationLabel(options[0]!, locations)}</p>
      </>
    );
  }
  return (
    <Select name={name} id={id ?? name} defaultValue={defaultValue ?? fallback}>
      {options.map((l) => (
        <option key={l.id} value={l.id}>
          {locationLabel(l, locations)}
        </option>
      ))}
    </Select>
  );
}
