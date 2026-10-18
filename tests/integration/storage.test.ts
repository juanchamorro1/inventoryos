import { describe, expect, it } from "vitest";
import { deleteStoredFile, readStoredFile, saveProductImage } from "@/server/storage";
import { createOrg, expectReject } from "./helpers";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

describe("imágenes de productos (guardadas en PostgreSQL)", () => {
  it("guarda una imagen válida, la lee y la borra", async () => {
    const org = await createOrg();
    const path = await saveProductImage(org.owner, new File([PNG], "foto.png", { type: "image/png" }));
    expect(path).toMatch(/^files\/[0-9a-f-]{36}$/);
    const file = await readStoredFile(org.owner, path);
    expect(file?.contentType).toBe("image/png");
    expect(file?.data.equals(PNG)).toBe(true);
    await deleteStoredFile(org.owner, path);
    expect(await readStoredFile(org.owner, path)).toBeNull();
  });

  it("otra empresa no puede leer la imagen", async () => {
    const a = await createOrg("Empresa A");
    const b = await createOrg("Empresa B");
    const path = await saveProductImage(a.owner, new File([PNG], "foto.png", { type: "image/png" }));
    expect(await readStoredFile(b.owner, path)).toBeNull();
    await deleteStoredFile(b.owner, path);
    expect(await readStoredFile(a.owner, path)).not.toBeNull();
  });

  it("rechaza archivos que no son imágenes aunque digan serlo", async () => {
    const org = await createOrg();
    const fake = new File([Buffer.from("<script>alert(1)</script>")], "x.png", { type: "image/png" });
    await expectReject(saveProductImage(org.owner, fake), "ValidationError");
  });

  it("rechaza imágenes de más de 2 MB", async () => {
    const org = await createOrg();
    const big = new File([Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])], "big.png", { type: "image/png" });
    await expectReject(saveProductImage(org.owner, big), "ValidationError");
  });

  it("ignora rutas que no son referencias válidas", async () => {
    const org = await createOrg();
    expect(await readStoredFile(org.owner, "../../.env.local")).toBeNull();
    expect(await readStoredFile(org.owner, "files/no-es-un-uuid")).toBeNull();
  });
});
