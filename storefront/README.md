# Tienda web (storefront)

Catálogo público que se alimenta solo de InventoryOS: productos, fotos, precios con IVA y disponibilidad salen de
`GET /api/v1/catalog` y se vuelven a leer cada `CATALOG_REVALIDATE_SECONDS` (60 s por defecto). El visitante arma un
carrito y lo envía como mensaje de WhatsApp; no se crean ventas en InventoryOS.

Proyecto independiente (su propio `package.json`): se despliega aparte y **nunca accede a la base de datos**.

## Puesta en marcha

1. En InventoryOS: *Configuración › Conexión con otros sistemas* → crea una clave con `catalog:read` e `inventory:read`.
2. `cp .env.example .env.local` y completa URL, clave, nombre de la tienda y WhatsApp.
3. `npm install` · `npm run dev` (puerto 3300).

Sin `inventory:read` la tienda funciona igual, pero no muestra Disponible/Agotado.

## Qué publica

- Solo lo que publica el contrato v1: productos y variantes activos con precio minorista > 0. Nunca costos ni márgenes.
- El stock se reduce a **Disponible / Agotado** en el servidor; la cantidad no llega al navegador.
- La clave API solo vive en el servidor. Las fotos pasan por `/img/<id>`, que solo sirve fotos de productos publicados.
- El carrito guarda SKU y cantidad en el navegador; al abrirlo se recalcula con el precio y la disponibilidad vigentes
  (los agotados no entran al pedido). Totales con `decimal.js`.

## Comandos

`npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test`
