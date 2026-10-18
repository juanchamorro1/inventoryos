import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId } from "./columns";
import { organizations } from "./platform";

export const warehouses = pgTable(
  "warehouses",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    status: text("status").notNull().default("active"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("warehouses_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("warehouses_org_code_uq").on(t.organizationId, sql`lower(${t.code})`),
    check("warehouses_status_ck", sql`${t.status} in ('active','archived')`),
  ],
);

export const locations = pgTable(
  "locations",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("locations_org_id_uq").on(t.organizationId, t.id),
    // Permite claves foráneas que garanticen que la ubicación pertenece a la bodega indicada.
    unique("locations_org_wh_id_uq").on(t.organizationId, t.warehouseId, t.id),
    uniqueIndex("locations_org_wh_code_uq").on(t.organizationId, t.warehouseId, sql`lower(${t.code})`),
    check("locations_status_ck", sql`${t.status} in ('active','archived')`),
    foreignKey({ name: "locations_warehouse_fk", columns: [t.organizationId, t.warehouseId], foreignColumns: [warehouses.organizationId, warehouses.id] }),
  ],
);
