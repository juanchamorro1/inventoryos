import { NextResponse } from "next/server";

// Contrato público v1 (solo lectura). Mantener sincronizado con src/server/modules/integrations/catalog-api.ts.
const money = { type: "string", description: "Decimal como texto (2 decimales)", example: "1599000.00" };
const Variant = {
  type: "object",
  required: ["sku", "product", "variant", "options", "price"],
  properties: {
    sku: { type: "string" },
    barcode: { type: ["string", "null"] },
    product: { type: "string" },
    variant: { type: "string" },
    options: { type: "object", additionalProperties: { type: "string" } },
    category: { type: ["string", "null"] },
    brand: { type: ["string", "null"] },
    price: {
      type: "object",
      properties: { currency: { type: "string", example: "COP" }, net: money, taxRate: { type: "string", example: "19" }, gross: money },
    },
    availability: {
      type: "object",
      description: "Presente solo si la clave tiene el permiso inventory:read",
      properties: {
        total: { type: "string" },
        byWarehouse: { type: "array", items: { type: "object", properties: { warehouse: { type: "string" }, code: { type: "string" }, quantity: { type: "string" } } } },
      },
    },
  },
};
const Problem = { type: "object", properties: { type: { type: "string" }, title: { type: "string" }, status: { type: "integer" } } };

const spec = {
  openapi: "3.1.0",
  info: { title: "InventoryOS API", version: "1.0.0", description: "Consulta de catálogo, precios y disponibilidad de la empresa dueña de la clave. Solo lectura." },
  servers: [{ url: "/api/v1" }],
  security: [{ bearer: [] }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Clave API creada en Configuración › Claves API (ios_…)" } },
    schemas: { Variant, Problem },
  },
  paths: {
    "/products": {
      get: {
        summary: "Buscar productos",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Nombre, SKU, código de barras, marca o categoría" },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          "200": {
            description: "Resultados",
            content: {
              "application/json": {
                schema: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Variant" } }, page: { type: "integer" }, limit: { type: "integer" }, hasMore: { type: "boolean" } } },
              },
            },
          },
          "401": { description: "Clave ausente, inválida o revocada", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } },
          "403": { description: "La clave no tiene el permiso necesario", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } },
        },
      },
    },
    "/products/{sku}": {
      get: {
        summary: "Consultar un SKU",
        parameters: [{ name: "sku", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Producto", content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Variant" } } } } } },
          "404": { description: "No existe en la empresa de la clave", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } },
        },
      },
    },
  },
};

export function GET() {
  return NextResponse.json(spec);
}
