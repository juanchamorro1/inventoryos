import { SectionTabs } from "./ui";

export function InventoryTabs({ active, lowCount }: { active: string; lowCount?: number }) {
  return (
    <SectionTabs
      active={active}
      tabs={[
        { href: "/inventory", label: "Existencias" },
        { href: "/inventory/alerts", label: "Por agotarse", count: lowCount },
        { href: "/inventory/movements", label: "Historial de movimientos" },
        { href: "/warehouses", label: "Bodegas" },
      ]}
    />
  );
}
