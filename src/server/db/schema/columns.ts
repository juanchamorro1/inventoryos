import { numeric, timestamp, uuid } from "drizzle-orm/pg-core";

// Precisiones acordadas (ver docs/architecture.md#precision):
//   cantidades     numeric(18,4)
//   costo unitario numeric(20,6)
//   dinero/valor   numeric(20,4)
//   tasas (%)      numeric(7,4)
export const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
export const unitCost = (name: string) => numeric(name, { precision: 20, scale: 6 });
export const money = (name: string) => numeric(name, { precision: 20, scale: 4 });
export const rate = (name: string) => numeric(name, { precision: 7, scale: 4 });

export const id = () => uuid("id").primaryKey().defaultRandom();
export const orgId = () => uuid("organization_id").notNull();
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
