import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { locations, warehouses } from "../../db/schema";
import { withTenantTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError } from "../../platform/errors";
import { requirePermission } from "../../platform/permissions";
import { assertWithinPlan } from "../../platform/plans";
import { optionalText, parseOrThrow } from "../../platform/validation";

const code = z
  .string()
  .trim()
  .min(1, "El código es obligatorio.")
  .max(30)
  .regex(/^[A-Za-z0-9._\-]+$/, "Usa letras, números, punto o guion.")
  .transform((v) => v.toUpperCase());

const warehouseSchema = z.object({
  code,
  name: z.string().trim().min(2, "Escribe un nombre.").max(120),
  address: optionalText(300),
});

const locationSchema = z.object({ code, name: z.string().trim().min(1, "Escribe un nombre.").max(120) });

export async function listWarehouses(ctx: TenantContext, opts: { includeArchived?: boolean } = {}) {
  requirePermission(ctx, "inventory.read");
  return withTenantTx(ctx, (tx) =>
    tx
      .select({
        id: warehouses.id,
        code: warehouses.code,
        name: warehouses.name,
        address: warehouses.address,
        status: warehouses.status,
        isDefault: warehouses.isDefault,
        locationCount: sql<number>`(select count(*)::int from locations l where l.warehouse_id = ${warehouses.id} and l.status = 'active')`,
        units: sql<string>`coalesce((select sum(sv.quantity) from stock_valuations sv where sv.warehouse_id = ${warehouses.id}), 0)`,
        value: sql<string>`coalesce((select sum(sv.total_value) from stock_valuations sv where sv.warehouse_id = ${warehouses.id}), 0)`,
      })
      .from(warehouses)
      .where(opts.includeArchived ? undefined : eq(warehouses.status, "active"))
      .orderBy(sql`${warehouses.isDefault} desc`, asc(warehouses.name)),
  );
}

/** Ubicaciones activas para selectores, con el nombre de su bodega. */
export async function listLocationOptions(ctx: TenantContext) {
  requirePermission(ctx, "inventory.read");
  return withTenantTx(ctx, (tx) =>
    tx
      .select({
        id: locations.id,
        code: locations.code,
        name: locations.name,
        isDefault: locations.isDefault,
        warehouseId: warehouses.id,
        warehouseName: warehouses.name,
        warehouseIsDefault: warehouses.isDefault,
      })
      .from(locations)
      .innerJoin(warehouses, eq(warehouses.id, locations.warehouseId))
      .where(and(eq(locations.status, "active"), eq(warehouses.status, "active")))
      .orderBy(sql`${warehouses.isDefault} desc`, asc(warehouses.name), sql`${locations.isDefault} desc`, asc(locations.code)),
  );
}

export async function getWarehouse(ctx: TenantContext, id: string) {
  requirePermission(ctx, "inventory.read");
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Bodega no encontrada.");
  return withTenantTx(ctx, async (tx) => {
    const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, id));
    if (!wh) throw new NotFoundError("Bodega no encontrada.");
    const locs = await tx
      .select({
        id: locations.id,
        code: locations.code,
        name: locations.name,
        status: locations.status,
        isDefault: locations.isDefault,
        units: sql<string>`coalesce((select sum(b.on_hand) from stock_balances b where b.location_id = ${locations.id}), 0)`,
      })
      .from(locations)
      .where(eq(locations.warehouseId, id))
      .orderBy(sql`${locations.isDefault} desc`, asc(locations.code));
    return { ...wh, locations: locs };
  });
}

function translate(err: unknown): never {
  if (isUniqueViolation(err)) throw new ValidationError("Ya existe uno con ese código.", { code: ["Código repetido."] });
  throw err;
}

export async function createWarehouse(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const input = parseOrThrow(warehouseSchema, raw);
  try {
    return await withTenantTx(ctx, async (tx) => {
      await assertWithinPlan(tx, ctx.organizationId, "warehouses");
      const [wh] = await tx
        .insert(warehouses)
        .values({ organizationId: ctx.organizationId, ...input })
        .returning({ id: warehouses.id });
      await tx.insert(locations).values({ organizationId: ctx.organizationId, warehouseId: wh!.id, code: "GENERAL", name: "General", isDefault: true });
      await audit(tx, ctx, "warehouse.created", { type: "warehouse", id: wh!.id }, input);
      return wh!.id;
    });
  } catch (err) {
    translate(err);
  }
}

export async function updateWarehouse(ctx: TenantContext, id: string, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const input = parseOrThrow(warehouseSchema, raw);
  try {
    await withTenantTx(ctx, async (tx) => {
      const updated = await tx.update(warehouses).set(input).where(eq(warehouses.id, id)).returning({ id: warehouses.id });
      if (updated.length === 0) throw new NotFoundError("Bodega no encontrada.");
      await audit(tx, ctx, "warehouse.updated", { type: "warehouse", id }, input);
    });
  } catch (err) {
    translate(err);
  }
}

/** Archiva una bodega sin existencias. Nunca se borra (hay historial que la referencia). */
export async function setWarehouseStatus(ctx: TenantContext, id: string, status: "active" | "archived") {
  requirePermission(ctx, "settings.manage");
  await withTenantTx(ctx, async (tx) => {
    const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, id)).for("update");
    if (!wh) throw new NotFoundError("Bodega no encontrada.");
    if (status === "archived") {
      if (wh.isDefault) throw new ConflictError("No puedes archivar la bodega principal. Marca otra como principal primero.");
      const [stock] = await tx.execute<{ units: string }>(sql`select coalesce(sum(on_hand), 0)::text as units from stock_balances where warehouse_id = ${id}`).then((r) => r.rows);
      if (stock && Number(stock.units) !== 0) throw new ConflictError("La bodega tiene existencias. Transfiérelas antes de archivarla.");
      const [open] = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from purchase_orders where warehouse_id = ${id} and status in ('draft','ordered','partially_received')`,
      ).then((r) => r.rows);
      if ((open?.n ?? 0) > 0) throw new ConflictError("La bodega tiene órdenes de compra abiertas.");
    }
    await tx.update(warehouses).set({ status }).where(eq(warehouses.id, id));
    await audit(tx, ctx, `warehouse.${status === "archived" ? "archived" : "restored"}`, { type: "warehouse", id });
  });
}

export async function setDefaultWarehouse(ctx: TenantContext, id: string) {
  requirePermission(ctx, "settings.manage");
  await withTenantTx(ctx, async (tx) => {
    const [wh] = await tx.select().from(warehouses).where(and(eq(warehouses.id, id), eq(warehouses.status, "active")));
    if (!wh) throw new NotFoundError("Bodega no encontrada.");
    await tx.update(warehouses).set({ isDefault: false }).where(ne(warehouses.id, id));
    await tx.update(warehouses).set({ isDefault: true }).where(eq(warehouses.id, id));
    await audit(tx, ctx, "warehouse.default", { type: "warehouse", id });
  });
}

export async function createLocation(ctx: TenantContext, warehouseId: string, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const input = parseOrThrow(locationSchema, raw);
  try {
    return await withTenantTx(ctx, async (tx) => {
      const [wh] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, warehouseId));
      if (!wh) throw new NotFoundError("Bodega no encontrada.");
      const [loc] = await tx
        .insert(locations)
        .values({ organizationId: ctx.organizationId, warehouseId, ...input })
        .returning({ id: locations.id });
      await audit(tx, ctx, "location.created", { type: "location", id: loc!.id }, { warehouseId, ...input });
      return loc!.id;
    });
  } catch (err) {
    translate(err);
  }
}

export async function setLocationStatus(ctx: TenantContext, id: string, status: "active" | "archived") {
  requirePermission(ctx, "settings.manage");
  await withTenantTx(ctx, async (tx) => {
    const [loc] = await tx.select().from(locations).where(eq(locations.id, id)).for("update");
    if (!loc) throw new NotFoundError("Ubicación no encontrada.");
    if (status === "archived") {
      if (loc.isDefault) throw new ConflictError("No puedes archivar la ubicación predeterminada de la bodega.");
      const [stock] = await tx.execute<{ units: string }>(sql`select coalesce(sum(on_hand), 0)::text as units from stock_balances where location_id = ${id}`).then((r) => r.rows);
      if (stock && Number(stock.units) !== 0) throw new ConflictError("La ubicación tiene existencias. Transfiérelas antes de archivarla.");
    }
    await tx.update(locations).set({ status }).where(eq(locations.id, id));
    await audit(tx, ctx, `location.${status === "archived" ? "archived" : "restored"}`, { type: "location", id });
  });
}
