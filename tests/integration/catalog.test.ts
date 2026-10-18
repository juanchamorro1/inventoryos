import { beforeAll, describe, expect, it } from "vitest";
import { exportProductsCsv, importProductsCsv } from "@/server/modules/catalog/csv";
import {
  createBrand,
  createCategory,
  createProduct,
  deleteCategory,
  getProduct,
  listProducts,
  listTaxRates,
  searchVariants,
  setProductStatus,
  updateProduct,
} from "@/server/modules/catalog/service";
import { createOrg, expectReject, memberCtx, type OrgFixture } from "./helpers";

describe("catálogo de productos", () => {
  let org: OrgFixture;

  beforeAll(async () => {
    org = await createOrg("Catálogo SA");
  });

  it("crea, consulta, edita y archiva un producto con variantes y atributos", async () => {
    const categoryId = await createCategory(org.owner, { name: "Celulares" });
    const brandId = await createBrand(org.owner, { name: "Samsung" });
    const iva = (await listTaxRates(org.owner)).find((t) => t.isDefault)!;
    const id = await createProduct(org.owner, {
      name: "Galaxy A55",
      categoryId,
      brandId,
      taxRateId: iva.id,
      attributes: { Pantalla: "6.6 pulgadas" },
      options: [{ name: "Color", values: ["Negro", "Azul"] }],
      variants: [
        { sku: "A55-NEG", optionValues: { Color: "Negro" }, costPrice: "1200000", salePrice: "1599000", lowStockThreshold: "2", barcode: "8806095467000" },
        { sku: "A55-AZU", optionValues: { Color: "Azul" }, costPrice: "1200000", salePrice: "1599000", lowStockThreshold: "2" },
      ],
    });
    const p = await getProduct(org.owner, id!);
    expect(p).toMatchObject({ name: "Galaxy A55", categoryName: "Celulares", brandName: "Samsung", taxName: "IVA 19%" });
    expect(p.variants.map((v) => v.name).sort()).toEqual(["Azul", "Negro"]);

    const keep = p.variants.find((v) => v.sku === "A55-NEG")!;
    await updateProduct(org.owner, id!, {
      name: "Galaxy A55 5G",
      categoryId,
      variants: [{ id: keep.id, sku: "A55-NEG", barcode: "8806095467000", optionValues: { Color: "Negro" }, costPrice: "1150000", salePrice: "1549000", lowStockThreshold: "3" }],
    });
    const updated = await getProduct(org.owner, id!);
    expect(updated.name).toBe("Galaxy A55 5G");
    expect(updated.variants.find((v) => v.sku === "A55-AZU")!.status).toBe("archived");
    expect(updated.variants.find((v) => v.sku === "A55-NEG")!.salePrice).toBe("1549000.0000");

    expect((await searchVariants(org.owner, "8806095467000"))[0]?.sku).toBe("A55-NEG");
    expect((await listProducts(org.owner, { search: "a55" })).total).toBe(1);

    await setProductStatus(org.owner, id!, "archived");
    expect((await listProducts(org.owner, { search: "a55" })).total).toBe(0);
    expect((await listProducts(org.owner, { search: "a55", status: "archived" })).total).toBe(1);
    await expectReject(deleteCategory(org.owner, categoryId!), "ConflictError");
  });

  it("SKU único por empresa (sin distinguir mayúsculas) y validaciones", async () => {
    await createProduct(org.owner, { name: "Cargador 20W", variants: [{ sku: "CARG-20W", costPrice: "20000", salePrice: "45000", lowStockThreshold: "0" }] });
    await expectReject(
      createProduct(org.owner, { name: "Otro", variants: [{ sku: "carg-20w", costPrice: "1", salePrice: "1", lowStockThreshold: "0" }] }),
      "ValidationError",
    );
    await expectReject(createProduct(org.owner, { name: "X", variants: [] }), "ValidationError");
    await expectReject(
      createProduct(org.owner, { name: "Precio malo", variants: [{ sku: "PM-1", costPrice: "-1", salePrice: "1", lowStockThreshold: "0" }] }),
      "ValidationError",
    );
    await expectReject(
      createProduct(org.owner, { name: "SKU raro", variants: [{ sku: "con espacio", costPrice: "1", salePrice: "1", lowStockThreshold: "0" }] }),
      "ValidationError",
    );
  });

  it("genera el código (SKU) si se deja vacío y crea categoría/marca por nombre", async () => {
    const id = await createProduct(org.owner, {
      name: "Cargador Rápido 33W",
      categoryName: "Cargadores",
      brandName: "Xiaomi",
      variants: [{ sku: "", costPrice: "42.000", salePrice: "89.900", lowStockThreshold: "2" }],
    });
    const p = await getProduct(org.owner, id!);
    expect(p.categoryName).toBe("Cargadores");
    expect(p.brandName).toBe("Xiaomi");
    expect(p.variants[0]!.sku).toMatch(/^CARRAP33W-[A-Z0-9]{4}$/);
    // Formato colombiano: 89.900 → 89900
    expect(p.variants[0]!.salePrice).toBe("89900.0000");
    // La misma categoría escrita con otras mayúsculas se reutiliza.
    const id2 = await createProduct(org.owner, { name: "Cable", categoryName: "cargadores", variants: [{ costPrice: "1", salePrice: "2", lowStockThreshold: "0" }] });
    expect((await getProduct(org.owner, id2!)).categoryId).toBe(p.categoryId);
  });

  it("solo lectura para viewer", async () => {
    const viewer = await memberCtx(org, "viewer");
    await expectReject(createProduct(viewer, { name: "Nope", variants: [{ sku: "NOPE", costPrice: "1", salePrice: "1", lowStockThreshold: "0" }] }), "ForbiddenError");
    expect((await listProducts(viewer)).total).toBeGreaterThan(0);
  });

  it("importación CSV: todo o nada con errores por fila", async () => {
    const bad = [
      "producto,sku,variante,opciones,categoria,marca,costo,precio,impuesto,stock_minimo",
      "Redmi Note 13,RN13-128,128GB,Memoria=128GB,Celulares,Xiaomi,700000,999000,IVA 19%,2",
      "Redmi Note 13,RN13-128,256GB,Memoria=256GB,Celulares,Xiaomi,800000,1099000,IVA 19%,2",
      "Funda,FUN-1,,,Accesorios,,abc,10000,,0",
      "Protector,PROT-1,,,Accesorios,,1000,5000,IVA 99%,0",
    ].join("\n");
    const r1 = await importProductsCsv(org.owner, bad);
    expect(r1.applied).toBe(false);
    expect(r1.errors.map((e) => e.row)).toEqual(expect.arrayContaining([3, 4]));
    expect((await listProducts(org.owner, { search: "Redmi" })).total).toBe(0);

    const good = [
      "producto;sku;variante;opciones;categoria;marca;codigo_barras;costo;precio;impuesto;stock_minimo",
      "Redmi Note 13;RN13-128;128GB;Memoria=128GB;Celulares;Xiaomi;;700000;999000;IVA 19%;2",
      "Redmi Note 13;RN13-256;256GB;Memoria=256GB;Celulares;Xiaomi;;800000;1099000;19;2",
      "Funda silicona;FUN-1;;;Accesorios;;7701234567890;5000;15000;Exento;5",
    ].join("\n");
    const r2 = await importProductsCsv(org.owner, good);
    expect(r2.errors).toEqual([]);
    expect(r2).toMatchObject({ applied: true, created: 3, productsCreated: 2 });
    const redmi = await listProducts(org.owner, { search: "Redmi" });
    expect(redmi.rows[0]!.variantCount).toBe(2);

    // Reimportar actualiza en vez de duplicar.
    const r3 = await importProductsCsv(org.owner, good.replace("999000", "949000"));
    expect(r3).toMatchObject({ applied: true, created: 0, updated: 3 });

    const csv = await exportProductsCsv(org.owner);
    expect(csv.split("\n")[0]).toContain("producto,sku,variante");
    expect(csv).toContain("RN13-128");
    expect(csv).toContain("949000");
  });

  it("la exportación neutraliza fórmulas (inyección CSV)", async () => {
    await createProduct(org.owner, { name: "=HYPERLINK(\"http://x\")", variants: [{ sku: "INJ-1", costPrice: "1", salePrice: "1", lowStockThreshold: "0" }] });
    const csv = await exportProductsCsv(org.owner);
    expect(csv).toContain("'=HYPERLINK");
  });
});
