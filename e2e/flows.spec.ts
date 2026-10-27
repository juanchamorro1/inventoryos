import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";

// Flujo completo desde la interfaz, contra la app compilada y una base de pruebas vacía.
// Las pruebas son secuenciales y comparten la empresa creada en la primera.

const PASSWORD = "ClaveE2E-2026";
const run = randomUUID().slice(0, 6);
const ownerEmail = `e2e-${run}@test.local`;
const SKU = `E2E-${run}`.toUpperCase();
let productUrl = "";

test.describe.configure({ mode: "serial" });

async function register(page: Page, email: string, company: string) {
  await page.goto("/register");
  await page.locator("#organizationName").fill(company);
  await page.locator("#name").fill("Persona E2E");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#passwordConfirm").fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function addLine(page: Page, sku: string) {
  const search = page.getByLabel("Buscar producto");
  await search.fill(sku);
  await page.getByRole("button", { name: new RegExp(sku) }).first().click();
}

test("registro de empresa y panel vacío", async ({ page }) => {
  await register(page, ownerEmail, `Tienda E2E ${run}`);
  await expect(page.getByText(/Primeros pasos/)).toBeVisible();
});

test("validaciones del formulario de producto", async ({ page }) => {
  await login(page, ownerEmail);
  await page.goto("/products/new");
  await page.locator("#name").fill("X");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.locator("main [role=alert]")).toBeVisible();
  await expect(page).toHaveURL(/\/products\/new/);
});

test("crear y editar producto", async ({ page }) => {
  await login(page, ownerEmail);
  await page.goto("/products/new");
  await page.locator("#name").fill("Celular de prueba E2E");
  // Precios escritos como en Colombia (punto de miles).
  await page.locator("#salePrice").fill("1.500");
  await page.locator("#costPrice").fill("1.000");
  await page.locator("#lowStock").fill("20");
  await page.locator("#sku").fill(SKU);
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}\?created=1$/);
  await expect(page.getByRole("heading", { name: "Celular de prueba E2E" })).toBeVisible();
  await expect(page.getByText("Producto guardado.")).toBeVisible();
  // Ganas por unidad = precio al cliente con IVA (1.500 × 1,19 = 1.785) − te cuesta (1.000).
  await expect(page.getByText("$ 785", { exact: true })).toBeVisible();
  await expect(page.getByText("Incluye $ 285 de IVA 19%", { exact: false })).toBeVisible();
  productUrl = page.url().split("?")[0]!;

  await page.getByRole("link", { name: "Editar" }).click();
  await page.locator("#name").fill("Celular de prueba E2E editado");
  // Foto (se guarda en PostgreSQL y se sirve solo a la empresa dueña).
  await page.getByText("3. Más detalles (opcional)").click();
  await page.locator("#image").setInputFiles({
    name: "foto.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005fe02fe0dd8e9a20000000049454e44ae426082",
      "hex",
    ),
  });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("heading", { name: "Celular de prueba E2E editado" })).toBeVisible();
  const img = page.getByRole("img", { name: "Celular de prueba E2E editado" });
  await expect(img).toBeVisible();
  // Espera a que el navegador termine de descargar la imagen antes de comprobar que es válida.
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
});

test("entrada de inventario desde la interfaz", async ({ page }) => {
  await login(page, ownerEmail);
  await page.goto("/inventory/new?type=receipt");
  await addLine(page, SKU);
  await page.getByLabel(`Cantidad de ${SKU}`).fill("10");
  await page.getByLabel(`Costo de ${SKU}`).fill("1000");
  await page.getByRole("button", { name: "Ingresar mercancía" }).click();
  await expect(page.getByRole("heading", { name: "Ingreso de mercancía" })).toBeVisible();
  await expect(page.getByText("Listo, quedó registrado.")).toBeVisible();
  await expect(page.getByText("+10")).toBeVisible();
});

test("orden de compra con recepción parcial", async ({ page }) => {
  await login(page, ownerEmail);
  await page.goto("/purchasing/suppliers/new");
  await page.locator("#name").fill(`Proveedor E2E ${run}`);
  await page.getByRole("button", { name: "Crear proveedor" }).click();
  await page.getByRole("link", { name: "Nueva orden" }).click();
  await addLine(page, SKU);
  await page.getByLabel(`Cantidad de ${SKU}`).fill("5");
  await page.getByLabel(`Costo de ${SKU}`).fill("1300");
  await page.getByRole("button", { name: "Guardar pedido" }).click();
  await expect(page.getByText("Borrador", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Marcar como pedido" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, marcar como pedido" }).click();
  await expect(page.getByText("Pedido al proveedor", { exact: true })).toBeVisible();

  await page.getByLabel(`Cantidad recibida de ${SKU}`).fill("2");
  await page.getByRole("button", { name: "Guardar lo que llegó" }).click();
  await expect(page.getByText("Llegó una parte", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "REC-000001" })).toBeVisible();
});

test("venta, devolución parcial y anulación", async ({ page }) => {
  await login(page, ownerEmail);
  await page.goto("/sales/new");
  await addLine(page, SKU);
  await page.getByLabel(`Cantidad de ${SKU}`).fill("3");
  await page.getByRole("button", { name: "Confirmar venta" }).click();
  await expect(page.getByText("Venta registrada correctamente.")).toBeVisible();

  await page.getByLabel(`Devolver ${SKU}`).fill("1");
  await page.locator("#reason").fill("Cliente insatisfecho");
  await page.getByRole("button", { name: "Registrar devolución" }).click();
  await expect(page.getByText("Con devolución parcial", { exact: true })).toBeVisible();

  // Venta de más unidades de las disponibles: debe mostrar el error y no registrar nada.
  await page.goto("/sales/new");
  await addLine(page, SKU);
  await page.getByLabel(`Cantidad de ${SKU}`).fill("999");
  await page.getByRole("button", { name: "Confirmar venta" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("Stock insuficiente");

  // Nueva venta y anulación.
  await page.getByLabel(`Cantidad de ${SKU}`).fill("1");
  await page.getByRole("button", { name: "Confirmar venta" }).click();
  await expect(page.getByText("Venta registrada correctamente.")).toBeVisible();
  await page.getByRole("button", { name: "Anular venta" }).click();
  await page.getByRole("dialog").getByLabel("Motivo").fill("Error de digitación");
  await page.getByRole("dialog").getByRole("button", { name: "Anular" }).click();
  await expect(page.getByText(/Anulada el/)).toBeVisible();

  // Existencias: 10 + 2 (compra) − 3 + 1 (devolución) − 1 + 1 (anulación) = 10; costo promedio (10·1000 + 2·1300) / 12 = 1050
  await page.goto(productUrl);
  await expect(page.getByText("10 unid.")).toBeVisible();
  await expect(page.getByText("$ 1.050", { exact: true })).toBeVisible();
});

test("verificación de consistencia sin diferencias", async ({ page }) => {
  await login(page, ownerEmail);
  await page.goto("/settings/consistency");
  await page.getByRole("button", { name: "Ejecutar verificación" }).click();
  await expect(page.getByText(/Sin diferencias/)).toBeVisible();
});

test("clave API: consulta de catálogo y disponibilidad", async ({ page, request }) => {
  await login(page, ownerEmail);
  await page.goto("/settings/api-keys");
  await page.locator("#kname").fill("WhatsApp E2E");
  await page.getByRole("button", { name: "Crear clave" }).click();
  const key = (await page.getByTestId("new-api-key").textContent())!.trim();
  expect(key).toMatch(/^ios_/);

  const res = await request.get(`/api/v1/products?q=${SKU}`, { headers: { Authorization: `Bearer ${key}` } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.data).toHaveLength(1);
  expect(body.data[0]).toMatchObject({ sku: SKU, price: { net: "1500.00" }, availability: { total: "10" } });

  const unauth = await request.get(`/api/v1/products?q=${SKU}`);
  expect(unauth.status()).toBe(401);
});

test("precios en USD: TRM manual, precio automático, cambio de tasa con aprobación e importación por lotes", async ({ page }) => {
  await login(page, ownerEmail);
  await page.goto("/pricing");
  await page.locator("#rate").fill("4000");
  await page.locator("#reason").fill("TRM de prueba E2E");
  await page.getByRole("button", { name: "Registrar tasa" }).click();
  await expect(page.getByText(/TRM manual registrada/)).toBeVisible();
  await expect(page.getByTestId("rate-indicator")).toContainText("4.100");

  // Producto con costo en USD y precio vacío = automático: 100 × (4000 + 100) / (1 − 30 %) = 585.714,29 → 585.800
  await page.goto("/products/new");
  await page.locator("#name").fill(`Importado USD ${run}`);
  await page.locator("#costPrice").fill("100");
  await page.locator("#costCurrency").selectOption("USD");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}\?created=1/);
  const usdUrl = page.url().split("?")[0]!;
  await expect(page.getByText("$ 585.800").first()).toBeVisible();

  // Nueva TRM: con la política predeterminada (aprobación) el precio publicado no cambia hasta aprobar.
  await page.goto("/pricing");
  await page.locator("#rate").fill("4400");
  await page.locator("#reason").fill("Sube la TRM");
  await page.getByRole("button", { name: "Registrar tasa" }).click();
  await expect(page.getByText(/cambios pendientes de aprobación/)).toBeVisible();
  await page.goto(usdUrl);
  await expect(page.getByText("$ 585.800").first()).toBeVisible();
  await page.goto("/pricing/changes");
  await expect(page.getByRole("link", { name: `Importado USD ${run}` })).toBeVisible();
  await page.getByRole("button", { name: /Aprobar todos/ }).click();
  await expect(page.getByText(/Se publicaron/)).toBeVisible();
  await page.goto(usdUrl);
  // 100 × 4500 / 0,7 = 642.857,14 → 642.900
  await expect(page.getByText("$ 642.900").first()).toBeVisible();

  // Importación por lotes: primero valida, luego importa.
  await page.goto("/products/import");
  const csv = ["producto,sku,moneda_costo,costo,precio", `Lote E2E ${run},LOTE-A-${run},USD,10,`, `Lote E2E ${run},LOTE-B-${run},COP,20000,35000`].join("\n");
  await page.locator("#csv-file").setInputFiles({ name: "lote.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Validar" }).click();
  await expect(page.getByText(/Validación correcta: 2 filas/)).toBeVisible();
  await page.getByRole("button", { name: "Importar 2 filas" }).click();
  await expect(page.getByText(/Importación terminada: 2 productos nuevos/)).toBeVisible();
  await page.goto(`/products?q=LOTE-B-${run}`);
  await expect(page.getByText("$ 35.000")).toBeVisible();
});

test("invitación: la persona crea su propia contraseña y el enlace es de un solo uso", async ({ page, browser }) => {
  await login(page, ownerEmail);
  await page.goto("/settings/members");
  const invitee = `e2e-inv-${run}@test.local`;
  await page.locator("#iemail").fill(invitee);
  await page.locator("#irole").selectOption("staff");
  await page.getByRole("button", { name: "Crear invitación" }).click();
  const link = (await page.getByTestId("invite-link").textContent())!.trim();
  const path = new URL(link).pathname;
  expect(path).toMatch(/^\/invite\/[A-Za-z0-9_-]{43}$/);
  await page.reload();
  await expect(page.getByRole("cell", { name: new RegExp(invitee) })).toBeVisible();

  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(path);
  await expect(guest.getByText(`Te invitaron a Tienda E2E ${run}`)).toBeVisible();
  await guest.locator("#name").fill("Persona Invitada");
  await guest.locator("#password").fill(PASSWORD);
  await guest.locator("#passwordConfirm").fill(PASSWORD);
  await guest.getByRole("button", { name: "Crear cuenta y unirme" }).click();
  await expect(guest).toHaveURL(/\/dashboard/);

  // Reutilizar el enlace ya no sirve.
  await guest.getByRole("button", { name: "Salir" }).click();
  await guest.goto(path);
  await expect(guest.getByText(/ya fue usada/)).toBeVisible();
  await context.close();
});

test("otra empresa no puede ver los datos de la primera", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await register(page, `e2e-b-${run}@test.local`, `Otra empresa ${run}`);
  await page.goto(productUrl);
  await expect(page.getByText("No encontramos lo que buscas")).toBeVisible();
  await page.goto("/products");
  await expect(page.getByText(SKU)).toHaveCount(0);
  await context.close();
});

test("recuperar contraseña responde igual exista o no la cuenta", async ({ page }) => {
  const messages: string[] = [];
  for (const email of [ownerEmail, `nadie-${run}@test.local`]) {
    await page.goto("/forgot-password");
    await page.locator("#email").fill(email);
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    const alert = page.locator("main [role=status], main [role=alert]").filter({ hasText: /Si el correo/ });
    await expect(alert).toBeVisible();
    messages.push((await alert.textContent())!.trim());
  }
  expect(messages[0]).toBe(messages[1]);
});

test("cerrar sesión en todos los dispositivos", async ({ page, browser }) => {
  await login(page, ownerEmail);
  const other = await browser.newContext();
  const second = await other.newPage();
  await login(second, ownerEmail);

  await page.goto("/account");
  await page.getByRole("button", { name: "Cerrar sesión en todos los dispositivos" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar todas" }).click();
  await expect(page).toHaveURL(/\/login\?sessions=closed/);
  // La otra sesión (otro navegador) también quedó cerrada.
  await second.goto("/dashboard");
  await expect(second).toHaveURL(/\/login/);
  await other.close();
});

test("plataforma: solo administradores; enlace de recuperación y bloqueo de una cuenta", async ({ page, browser }) => {
  const invitee = `e2e-inv-${run}@test.local`;
  // Sin el rol, /platform no existe para la persona.
  await login(page, ownerEmail);
  const denied = await page.goto("/platform");
  expect(denied?.status()).toBe(404);

  // El rol se otorga solo con el rol dueño de la base (como `npm run platform:admin`).
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
  await db.connect();
  await db.query("insert into platform_admins (user_id) select id from users where lower(email) = $1 on conflict do nothing", [ownerEmail]);
  await db.end();

  await page.goto(`/platform?email=${encodeURIComponent(invitee)}`);
  await expect(page.getByText("Persona Invitada")).toBeVisible();
  await page.getByRole("button", { name: "Generar enlace para restablecer la contraseña" }).click();
  const link = (await page.getByTestId("reset-link").textContent())!.trim();

  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(new URL(link).pathname);
  await guest.locator("#password").fill("NuevaClaveE2E-2027");
  await guest.locator("#passwordConfirm").fill("NuevaClaveE2E-2027");
  await guest.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(guest).toHaveURL(/\/login\?reset=1/);
  await guest.locator("#email").fill(invitee);
  await guest.locator("#password").fill("NuevaClaveE2E-2027");
  await guest.getByRole("button", { name: "Ingresar" }).click();
  await expect(guest).toHaveURL(/\/dashboard/);

  // Bloqueo: la sesión abierta de la persona deja de funcionar al instante.
  await page.reload();
  await page.getByRole("button", { name: "Bloquear cuenta" }).click();
  await page.getByRole("dialog").getByLabel("Motivo").fill("Prueba de bloqueo E2E");
  await page.getByRole("dialog").getByRole("button", { name: "Bloquear" }).click();
  await expect(page.getByTestId("account-status")).toContainText("Bloqueada");
  await guest.goto("/dashboard");
  await expect(guest).toHaveURL(/\/login/);
  await guest.locator("#email").fill(invitee);
  await guest.locator("#password").fill("NuevaClaveE2E-2027");
  await guest.getByRole("button", { name: "Ingresar" }).click();
  await expect(guest.getByText("Correo o contraseña incorrectos.")).toBeVisible();
  await context.close();
});

test("cierre de sesión", async ({ page }) => {
  await login(page, ownerEmail);
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
