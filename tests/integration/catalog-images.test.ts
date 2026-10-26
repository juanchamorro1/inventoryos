import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { productImages } from "@/server/db/schema";
import { withTenantTx } from "@/server/db/tx";
import {
  addProductImage,
  deleteProductImage,
  listProductImages,
  MAX_IMAGES_PER_PRODUCT,
  moveProductImage,
  readProductImage,
  setPrimaryImage,
  updateImageAlt,
} from "@/server/modules/catalog/images";
import { createProduct, listProducts } from "@/server/modules/catalog/service";
import { createOrg, expectPgError, expectReject, memberCtx } from "./helpers";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005fe02fe0dd8e9a20000000049454e44ae426082", "hex");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const file = (data: Buffer, name = "foto.png", type = "image/png") => new File([new Uint8Array(data)], name, { type });

async function setup() {
  const org = await createOrg("Fotos");
  const productId = (await createProduct(org.owner, { name: "Celular con fotos", variants: [{ sku: `F-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, costPrice: "1", salePrice: "2", lowStockThreshold: "0" }] }))!;
  return { org, productId };
}

describe("fotos de productos", () => {
  it("varias fotos: la primera es la principal, orden, texto alternativo y lectura", async () => {
    const { org, productId } = await setup();
    const a = await addProductImage(org.owner, productId, file(PNG));
    const b = await addProductImage(org.owner, productId, file(JPG, "b.jpg", "image/jpeg"), "Vista trasera");
    let imgs = await listProductImages(org.owner, productId);
    expect(imgs.map((i) => [i.id, i.isPrimary, i.position, i.altText])).toEqual([
      [a, true, 0, "Celular con fotos"],
      [b, false, 1, "Vista trasera"],
    ]);
    expect(imgs[1]!.contentType).toBe("image/jpeg");
    const obj = await readProductImage(org.owner, a);
    expect(obj).toMatchObject({ kind: "data", contentType: "image/png" });
    expect(obj?.kind === "data" && obj.data.equals(PNG)).toBe(true);

    await setPrimaryImage(org.owner, b);
    await moveProductImage(org.owner, b, "up");
    imgs = await listProductImages(org.owner, productId);
    expect(imgs.map((i) => [i.id, i.isPrimary])).toEqual([
      [b, true],
      [a, false],
    ]);
    await updateImageAlt(org.owner, a, "Vista frontal");
    await expectReject(updateImageAlt(org.owner, a, ""), "ValidationError");
    expect((await listProductImages(org.owner, productId)).find((i) => i.id === a)!.altText).toBe("Vista frontal");

    // El listado devuelve solo el id de la foto principal, nunca el archivo.
    const list = await listProducts(org.owner, { search: "Celular con fotos" });
    expect(list.rows[0]!.primaryImageId).toBe(b);
    expect(JSON.stringify(list)).not.toContain(PNG.toString("base64"));
  });

  it("borrar la principal promueve la siguiente y elimina el archivo", async () => {
    const { org, productId } = await setup();
    const a = await addProductImage(org.owner, productId, file(PNG));
    const b = await addProductImage(org.owner, productId, file(PNG));
    const [row] = await withTenantTx(org.owner, (tx) => tx.select({ key: productImages.storageKey }).from(productImages).where(eq(productImages.id, a)));
    await deleteProductImage(org.owner, a);
    expect((await listProductImages(org.owner, productId)).map((i) => [i.id, i.isPrimary])).toEqual([[b, true]]);
    const left = await withTenantTx(org.owner, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from stored_files where id = ${row!.key}::uuid`));
    expect(left.rows[0]!.n).toBe(0);
    await expectReject(deleteProductImage(org.owner, a), "NotFoundError");
  });

  it("valida el tipo real, el tamaño y el máximo de fotos por producto", async () => {
    const { org, productId } = await setup();
    await expectReject(addProductImage(org.owner, productId, file(Buffer.from("<svg onload=alert(1)>"), "x.png")), /Formato de imagen no permitido/);
    await expectReject(addProductImage(org.owner, productId, file(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]))), /más de 2 MB/);
    await expectReject(addProductImage(org.owner, productId, file(Buffer.alloc(0))), "ValidationError");
    for (let i = 0; i < MAX_IMAGES_PER_PRODUCT; i++) await addProductImage(org.owner, productId, file(PNG));
    await expectReject(addProductImage(org.owner, productId, file(PNG)), /máximo 10 fotos/);
    // Nunca más de una principal (índice único parcial).
    await expectPgError(withTenantTx(org.owner, (tx) => tx.update(productImages).set({ isPrimary: true }).where(eq(productImages.productId, productId))), "23505");
  });

  it("autorización: solo lectura no sube ni borra; otra empresa no ve ni toca las fotos", async () => {
    const { org, productId } = await setup();
    const id = await addProductImage(org.owner, productId, file(PNG));
    const viewer = await memberCtx(org, "viewer");
    await expectReject(addProductImage(viewer, productId, file(PNG)), "ForbiddenError");
    await expectReject(deleteProductImage(viewer, id), "ForbiddenError");
    expect(await readProductImage(viewer, id)).not.toBeNull();

    const other = await createOrg("Otra empresa fotos");
    expect(await readProductImage(other.owner, id)).toBeNull();
    expect(await listProductImages(other.owner, productId)).toEqual([]);
    await expectReject(addProductImage(other.owner, productId, file(PNG)), "NotFoundError");
    await expectReject(setPrimaryImage(other.owner, id), "NotFoundError");
    await expectReject(deleteProductImage(other.owner, id), "NotFoundError");
    await expectReject(moveProductImage(other.owner, id, "up"), "NotFoundError");
    expect(await readProductImage(org.owner, id)).not.toBeNull();
    // La base rechaza una foto con organization_id ajeno (RLS WITH CHECK).
    await expectPgError(
      withTenantTx(other.owner, (tx) => tx.insert(productImages).values({ organizationId: org.organizationId, productId, storageDriver: "database", storageKey: "x", contentType: "image/png", size: 1 })),
      "42501",
    );
  });
});
