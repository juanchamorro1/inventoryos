import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deleteStoredFile, readStoredFile, saveProductImage } from "@/server/storage";
import { expectReject } from "./helpers";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

describe("imágenes de productos", () => {
  it("guarda PNG válido dentro de la carpeta de la empresa y lo lee", async () => {
    const org = randomUUID();
    const path = await saveProductImage(org, randomUUID(), new File([PNG], "foto.png", { type: "image/png" }));
    expect(path.startsWith(`products/${org}/`)).toBe(true);
    const file = await readStoredFile(path);
    expect(file?.contentType).toBe("image/png");
    await deleteStoredFile(path);
    expect(await readStoredFile(path)).toBeNull();
  });

  it("rechaza archivos que no son imágenes aunque digan serlo", async () => {
    const fake = new File([Buffer.from("<script>alert(1)</script>")], "x.png", { type: "image/png" });
    await expectReject(saveProductImage(randomUUID(), randomUUID(), fake), "ValidationError");
  });

  it("rechaza imágenes de más de 2 MB", async () => {
    const big = new File([Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])], "big.png", { type: "image/png" });
    await expectReject(saveProductImage(randomUUID(), randomUUID(), big), "ValidationError");
  });

  it("no permite salir de la carpeta de almacenamiento", async () => {
    expect(await readStoredFile("../../.env.local")).toBeNull();
    await expectReject(deleteStoredFile("../../package.json").then(() => {
      throw new Error("no debería llegar aquí");
    }), /ValidationError|no debería/);
  });
});
