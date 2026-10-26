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
const Price = { type: "object", properties: { net: money, taxRate: { type: "string", example: "19" }, gross: money } };
const CatalogProduct = {
  type: "object",
  description: "Producto publicado (contrato de lectura v1 para la web pública). Nunca incluye costos, márgenes ni proveedores.",
  required: ["id", "name", "variants", "images", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid", description: "Identificador estable del producto" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    category: { type: ["string", "null"] },
    brand: { type: ["string", "null"] },
    unit: { type: "string" },
    attributes: { type: "object", additionalProperties: { type: "string" } },
    images: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, url: { type: "string", description: "/api/v1/images/{id} (misma clave API)" }, alt: { type: "string" }, primary: { type: "boolean" }, position: { type: "integer" } } },
    },
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sku: { type: "string", description: "Identificador estable de la variante" },
          barcode: { type: ["string", "null"] },
          name: { type: "string" },
          options: { type: "object", additionalProperties: { type: "string" } },
          prices: {
            type: "object",
            properties: {
              currency: { type: "string", example: "COP" },
              retail: Price,
              wholesale: { oneOf: [{ type: "null" }, { allOf: [Price, { type: "object", properties: { minQuantity: { type: ["string", "null"] } } }] }] },
            },
          },
          availability: { type: "object", description: "Solo con el permiso inventory:read", properties: { total: { type: "string" } } },
        },
      },
    },
    updatedAt: { type: "string", format: "date-time" },
  },
};
const Problem = { type: "object", properties: { type: { type: "string" }, title: { type: "string" }, status: { type: "integer" } } };

const spec = {
  openapi: "3.1.0",
  info: { title: "InventoryOS API", version: "1.1.0", description: "Consulta de catálogo, precios y disponibilidad de la empresa dueña de la clave. Solo lectura." },
  servers: [{ url: "/api/v1" }],
  security: [{ bearer: [] }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Clave API creada en Configuración › Claves API (ios_…)" } },
    schemas: { Variant, CatalogProduct, Problem },
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
    "/catalog": {
      get: {
        summary: "Catálogo publicado (productos con variantes, fotos y precios)",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Nombre, SKU o código de referencia" },
          { name: "category", in: "query", schema: { type: "string" }, description: "Nombre exacto de la categoría" },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 24 } },
        ],
        responses: {
          "200": {
            description: "Página de productos",
            content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/CatalogProduct" } }, page: { type: "integer" }, limit: { type: "integer" }, hasMore: { type: "boolean" } } } } },
          },
          "401": { description: "Clave ausente, inválida o revocada", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } },
          "403": { description: "La clave no tiene el permiso necesario", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } },
        },
      },
    },
    "/images/{id}": {
      get: {
        summary: "Foto de un producto",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Imagen (JPG, PNG o WEBP)" },
          "302": { description: "Redirección a una URL prefirmada de corta duración (almacenamiento S3)" },
          "404": { description: "No existe en la empresa de la clave", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } },
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
