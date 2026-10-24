// Carga una empresa de DEMOSTRACIÓN (tienda de celulares) marcada con is_demo = true.
//   npm run db:seed:demo -- --email demo@tu-dominio.com
// - Crea una empresa nueva cada vez: nunca toca empresas existentes ni datos reales.
// - Las contraseñas se generan aleatoriamente y se muestran una sola vez.
// - Todo pasa por los mismos servicios que usa la aplicación (validaciones, ledger, auditoría).
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { closeDb } from "../src/server/db/client";
import { withGlobalTx } from "../src/server/db/tx";
import { eq } from "drizzle-orm";
import { organizations, users } from "../src/server/db/schema";
import { buildTenantContext, createOrganization } from "../src/server/modules/auth/service";
import { generatePassword, hashPassword } from "../src/server/modules/auth/password";
import { createBrand, createCategory, createProduct, getProduct, listTaxRates } from "../src/server/modules/catalog/service";
import { postManualDocument } from "../src/server/modules/inventory/service";
import { acceptInvitationWithNewAccount, createInvitation } from "../src/server/modules/invitations/service";
import {
  createPurchaseOrder,
  createSupplier,
  getPurchaseOrder,
  issuePurchaseOrder,
  receivePurchaseOrder,
} from "../src/server/modules/purchasing/service";
import { createCustomer, createSale, returnSale, getSale, cancelSale } from "../src/server/modules/sales/service";
import { createLocation, createWarehouse, getWarehouse, listLocationOptions } from "../src/server/modules/warehouses/service";
import { arg } from "./lib/args";

const email = (arg("email") ?? `demo-${randomUUID().slice(0, 6)}@inventoryos.local`).toLowerCase();

async function main() {
  const ownerPassword = generatePassword();
  const passwordHash = await hashPassword(ownerPassword);
  const { userId, organizationId } = await withGlobalTx(async (tx) => {
    const [u] = await tx.insert(users).values({ email, name: "Administrador Demo", passwordHash }).returning({ id: users.id });
    const organizationId = await createOrganization(tx, { userId: u!.id, name: "CeluMundo (demostración)", currency: "COP", isDemo: true });
    // Plan Profesional para que la demostración incluya varios usuarios y bodegas.
    await tx.update(organizations).set({ plan: "pro" }).where(eq(organizations.id, organizationId));
    return { userId: u!.id, organizationId };
  });
  const ctx = await buildTenantContext(userId, organizationId);

  // Bodegas y ubicaciones
  const main = (await listLocationOptions(ctx)).find((l) => l.isDefault && l.warehouseIsDefault)!;
  const storeId = (await createWarehouse(ctx, { code: "TIENDA-CENTRO", name: "Tienda Centro", address: "Cra. 7 # 12-34, local 5" }))!;
  const storeDefault = (await getWarehouse(ctx, storeId)).locations[0]!.id;
  const vitrina = (await createLocation(ctx, storeId, { code: "VITRINA", name: "Vitrina de exhibición" }))!;

  // Catálogo
  const cat = {
    phones: (await createCategory(ctx, { name: "Celulares" }))!,
    acc: (await createCategory(ctx, { name: "Accesorios" }))!,
    tablets: (await createCategory(ctx, { name: "Tablets" }))!,
    parts: (await createCategory(ctx, { name: "Repuestos" }))!,
  };
  const brand: Record<string, string> = {};
  for (const b of ["Apple", "Samsung", "Xiaomi", "Motorola", "Genérico"]) brand[b] = (await createBrand(ctx, { name: b }))!;
  const taxes = await listTaxRates(ctx);
  const iva19 = taxes.find((t) => t.name === "IVA 19%")!.id;

  type V = { sku: string; opts?: Record<string, string>; cost: string; price: string; min?: string; barcode?: string };
  const products: { name: string; category: string; brand: string; attrs: Record<string, string>; options?: { name: string; values: string[] }[]; variants: V[] }[] = [
    {
      name: "iPhone 15",
      category: cat.phones,
      brand: brand.Apple!,
      attrs: { Pantalla: '6,1" OLED', Garantía: "12 meses" },
      options: [{ name: "Almacenamiento", values: ["128GB", "256GB"] }, { name: "Color", values: ["Negro", "Azul"] }],
      variants: [
        { sku: "IP15-128-NEG", opts: { Almacenamiento: "128GB", Color: "Negro" }, cost: "3450000", price: "4199000", min: "2", barcode: "0194253715191" },
        { sku: "IP15-128-AZU", opts: { Almacenamiento: "128GB", Color: "Azul" }, cost: "3450000", price: "4199000", min: "2" },
        { sku: "IP15-256-NEG", opts: { Almacenamiento: "256GB", Color: "Negro" }, cost: "3990000", price: "4799000", min: "1" },
      ],
    },
    {
      name: "Samsung Galaxy A55 5G",
      category: cat.phones,
      brand: brand.Samsung!,
      attrs: { Pantalla: '6,6" Super AMOLED', Batería: "5000 mAh" },
      options: [{ name: "Color", values: ["Negro", "Lila"] }],
      variants: [
        { sku: "A55-NEG", opts: { Color: "Negro" }, cost: "1180000", price: "1599000", min: "3", barcode: "8806095467801" },
        { sku: "A55-LIL", opts: { Color: "Lila" }, cost: "1180000", price: "1599000", min: "2" },
      ],
    },
    {
      name: "Xiaomi Redmi Note 13",
      category: cat.phones,
      brand: brand.Xiaomi!,
      attrs: { Pantalla: '6,67" AMOLED', Cámara: "108 MP" },
      options: [{ name: "Almacenamiento", values: ["128GB", "256GB"] }],
      variants: [
        { sku: "RN13-128", opts: { Almacenamiento: "128GB" }, cost: "690000", price: "949000", min: "4" },
        { sku: "RN13-256", opts: { Almacenamiento: "256GB" }, cost: "790000", price: "1099000", min: "2" },
      ],
    },
    { name: "Motorola Moto G54", category: cat.phones, brand: brand.Motorola!, attrs: { Pantalla: '6,5"' }, variants: [{ sku: "MG54", cost: "560000", price: "799000", min: "3" }] },
    { name: "Samsung Galaxy Tab A9", category: cat.tablets, brand: brand.Samsung!, attrs: { Pantalla: '8,7"' }, variants: [{ sku: "TAB-A9", cost: "520000", price: "749000", min: "1" }] },
    { name: "Cargador USB-C 20W", category: cat.acc, brand: brand.Apple!, attrs: {}, variants: [{ sku: "CARG-20W", cost: "45000", price: "99000", min: "10", barcode: "0194252192368" }] },
    { name: "Cable USB-C a USB-C 1 m", category: cat.acc, brand: brand["Genérico"]!, attrs: {}, variants: [{ sku: "CAB-CC-1M", cost: "6500", price: "25000", min: "20" }] },
    { name: "Audífonos inalámbricos Buds", category: cat.acc, brand: brand.Xiaomi!, attrs: { Autonomía: "28 h" }, variants: [{ sku: "BUDS-X", cost: "68000", price: "139000", min: "5" }] },
    {
      name: "Funda de silicona",
      category: cat.acc,
      brand: brand["Genérico"]!,
      attrs: {},
      options: [{ name: "Modelo", values: ["iPhone 15", "Galaxy A55"] }],
      variants: [
        { sku: "FUN-IP15", opts: { Modelo: "iPhone 15" }, cost: "9000", price: "39000", min: "8" },
        { sku: "FUN-A55", opts: { Modelo: "Galaxy A55" }, cost: "8000", price: "35000", min: "8" },
      ],
    },
    { name: "Vidrio templado 9H", category: cat.acc, brand: brand["Genérico"]!, attrs: {}, variants: [{ sku: "VID-9H", cost: "3000", price: "20000", min: "25" }] },
    { name: "Pantalla repuesto Redmi Note 13", category: cat.parts, brand: brand.Xiaomi!, attrs: { Tipo: "AMOLED original" }, variants: [{ sku: "REP-PANT-RN13", cost: "185000", price: "320000", min: "1" }] },
  ];

  const sku = new Map<string, string>();
  for (const p of products) {
    const id = await createProduct(ctx, {
      name: p.name,
      categoryId: p.category,
      brandId: p.brand,
      taxRateId: iva19,
      attributes: p.attrs,
      options: p.options ?? [],
      variants: p.variants.map((v) => ({ sku: v.sku, barcode: v.barcode ?? null, optionValues: v.opts ?? {}, costPrice: v.cost, salePrice: v.price, lowStockThreshold: v.min ?? "0" })),
    });
    const full = await getProduct(ctx, id!);
    for (const v of full.variants) sku.set(v.sku, v.id);
  }
  const v = (s: string) => sku.get(s)!;

  // Inventario inicial (entrada con costo)
  await postManualDocument(ctx, {
    type: "receipt",
    locationId: main.id,
    reason: "Inventario inicial (demostración)",
    lines: [
      { variantId: v("IP15-128-NEG"), quantity: "6", unitCost: "3450000" },
      { variantId: v("IP15-128-AZU"), quantity: "3", unitCost: "3450000" },
      { variantId: v("IP15-256-NEG"), quantity: "2", unitCost: "3990000" },
      { variantId: v("A55-NEG"), quantity: "8", unitCost: "1180000" },
      { variantId: v("A55-LIL"), quantity: "2", unitCost: "1180000" },
      { variantId: v("RN13-128"), quantity: "10", unitCost: "690000" },
      { variantId: v("RN13-256"), quantity: "4", unitCost: "790000" },
      { variantId: v("MG54"), quantity: "5", unitCost: "560000" },
      { variantId: v("CARG-20W"), quantity: "30", unitCost: "45000" },
      { variantId: v("CAB-CC-1M"), quantity: "60", unitCost: "6500" },
      { variantId: v("BUDS-X"), quantity: "12", unitCost: "68000" },
      { variantId: v("FUN-IP15"), quantity: "25", unitCost: "9000" },
      { variantId: v("FUN-A55"), quantity: "6", unitCost: "8000" },
      { variantId: v("VID-9H"), quantity: "80", unitCost: "3000" },
    ],
  });

  // Transferencia a la tienda
  await postManualDocument(ctx, {
    type: "transfer",
    fromLocationId: main.id,
    toLocationId: vitrina,
    reason: "Surtido de vitrina",
    lines: [
      { variantId: v("IP15-128-NEG"), quantity: "2" },
      { variantId: v("A55-NEG"), quantity: "3" },
      { variantId: v("RN13-128"), quantity: "3" },
    ],
  });
  await postManualDocument(ctx, {
    type: "transfer",
    fromLocationId: main.id,
    toLocationId: storeDefault,
    reason: "Surtido de accesorios",
    lines: [
      { variantId: v("CARG-20W"), quantity: "10" },
      { variantId: v("VID-9H"), quantity: "30" },
      { variantId: v("FUN-IP15"), quantity: "10" },
    ],
  });

  // Proveedores y compras
  const distri = (await createSupplier(ctx, { name: "Distribuidora Andina de Tecnología S.A.S.", taxId: "900123456-7", contactName: "Laura Méndez", email: "compras@andina-demo.test", phone: "+57 601 555 0101" }))!;
  const accesorios = (await createSupplier(ctx, { name: "Importadora Accesorios del Norte", taxId: "901234567-1", contactName: "Jorge Ruiz", phone: "+57 604 555 0202" }))!;
  await createSupplier(ctx, { name: "Repuestos Express", taxId: "830987654-3" });

  const po1 = await createPurchaseOrder(ctx, {
    supplierId: distri,
    warehouseId: main.warehouseId,
    notes: "Pedido mensual (demostración)",
    lines: [
      { variantId: v("A55-NEG"), quantity: "6", unitCost: "1150000", taxRate: "19" },
      { variantId: v("RN13-128"), quantity: "8", unitCost: "700000", taxRate: "19" },
      { variantId: v("TAB-A9"), quantity: "3", unitCost: "520000", taxRate: "19" },
    ],
  });
  await issuePurchaseOrder(ctx, po1);
  const po1d = await getPurchaseOrder(ctx, po1);
  await receivePurchaseOrder(ctx, po1, {
    locationId: main.id,
    notes: "Remisión 4521 — llegó incompleto",
    lines: po1d.lines.filter((l) => l.sku !== "TAB-A9").map((l) => ({ lineId: l.id, quantity: l.sku === "RN13-128" ? "5" : l.quantityOrdered })),
  });

  const po2 = await createPurchaseOrder(ctx, {
    supplierId: accesorios,
    warehouseId: main.warehouseId,
    lines: [
      { variantId: v("BUDS-X"), quantity: "10", unitCost: "65000", taxRate: "19" },
      { variantId: v("CAB-CC-1M"), quantity: "40", unitCost: "6000", taxRate: "19" },
    ],
  });
  await issuePurchaseOrder(ctx, po2);
  const po2d = await getPurchaseOrder(ctx, po2);
  await receivePurchaseOrder(ctx, po2, { locationId: main.id, lines: po2d.lines.map((l) => ({ lineId: l.id, quantity: l.quantityOrdered })) });

  await createPurchaseOrder(ctx, {
    supplierId: distri,
    warehouseId: main.warehouseId,
    notes: "Borrador pendiente de aprobación",
    lines: [{ variantId: v("IP15-256-NEG"), quantity: "3", unitCost: "3950000", taxRate: "19" }],
  });

  // Clientes y ventas
  const ana = (await createCustomer(ctx, { name: "Ana María Torres", documentNumber: "52123456", phone: "+57 300 555 1234" }))!;
  const carlos = (await createCustomer(ctx, { name: "Carlos Gómez", documentNumber: "80987654", email: "carlos@example.test" }))!;
  await createSale(ctx, { customerId: ana, locationId: vitrina, paymentMethod: "card", lines: [{ variantId: v("IP15-128-NEG"), quantity: "1" }] });
  await createSale(ctx, { locationId: storeDefault, paymentMethod: "cash", lines: [{ variantId: v("CARG-20W"), quantity: "2" }, { variantId: v("VID-9H"), quantity: "3" }] });
  await createSale(ctx, { customerId: carlos, locationId: vitrina, paymentMethod: "transfer", lines: [{ variantId: v("A55-NEG"), quantity: "1" }] });
  const s4 = await createSale(ctx, { locationId: main.id, paymentMethod: "cash", lines: [{ variantId: v("RN13-128"), quantity: "2", discount: "50000" }, { variantId: v("FUN-A55"), quantity: "2" }] });
  const s5 = await createSale(ctx, { locationId: storeDefault, paymentMethod: "cash", lines: [{ variantId: v("FUN-IP15"), quantity: "1" }] });
  await createSale(ctx, { locationId: main.id, paymentMethod: "card", lines: [{ variantId: v("BUDS-X"), quantity: "2" }, { variantId: v("CAB-CC-1M"), quantity: "4" }] });

  const s4d = await getSale(ctx, s4.saleId);
  await returnSale(ctx, s4.saleId, { reason: "Funda con defecto de fábrica (demostración)", lines: [{ saleLineId: s4d.lines.find((l) => l.lineNo === 2)!.id, quantity: "1" }] });
  await cancelSale(ctx, s5.saleId, "Venta registrada por error (demostración)");

  // Ajuste por conteo y salida por merma
  await postManualDocument(ctx, { type: "adjustment", locationId: main.id, reason: "Conteo semanal", lines: [{ variantId: v("VID-9H"), counted: "45" }] });
  await postManualDocument(ctx, { type: "issue", locationId: main.id, reason: "Equipo de exhibición dañado", lines: [{ variantId: v("CAB-CC-1M"), quantity: "1" }] });

  // Usuarios adicionales con roles distintos
  const extra: { email: string; role: "manager" | "staff" | "viewer"; password: string }[] = [];
  for (const role of ["manager", "staff", "viewer"] as const) {
    const password = generatePassword();
    const e = email.replace("@", `+${role}@`);
    // Mismo flujo que en la aplicación: invitación y aceptación con la contraseña de la persona invitada.
    const { token } = await createInvitation(ctx, { email: e, role });
    await acceptInvitationWithNewAccount(token, { name: `Usuario ${role} (demo)`, password });
    extra.push({ email: e, role, password });
  }

  console.log("\nEmpresa de demostración creada: CeluMundo (demostración)");
  console.log("Credenciales (se muestran solo esta vez):");
  console.log(`  propietario  ${email}  ${ownerPassword}`);
  for (const x of extra) console.log(`  ${x.role.padEnd(11)}  ${x.email}  ${x.password}`);
  // Copia local (carpeta .local/, ignorada por git) para no depender del historial de la terminal.
  mkdirSync(".local", { recursive: true });
  appendFileSync(
    ".local/demo-credentials.txt",
    [`# ${new Date().toISOString()} CeluMundo (demostración)`, `owner ${email} ${ownerPassword}`, ...extra.map((x) => `${x.role} ${x.email} ${x.password}`), ""].join("\n"),
    { mode: 0o600 },
  );
  console.log("\nCopia guardada en .local/demo-credentials.txt (no se sube al repositorio).");
  console.log("Abre la aplicación e inicia sesión. Los datos están marcados como demostración.");
}

try {
  await main();
} finally {
  await closeDb();
}
