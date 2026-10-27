// Tipos de negocio. Cada uno trae una configuración inicial sencilla para que la app no sea confusa:
// categorías habituales, datos que se piden en cada producto y qué sistemas de precios vienen encendidos.
// Todo se puede cambiar después; aplicar un tipo nunca borra datos.

export const BUSINESS_TYPES = ["cosmetics", "electronics", "general"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export type BusinessProfile = {
  label: string;
  description: string;
  /** Categorías que se crean si no existen. */
  categories: string[];
  /** Datos de la ficha técnica que se piden en cada producto nuevo (con un ejemplo). */
  attributes: { name: string; example: string }[];
  /** Ejemplo de nombre de producto para el formulario. */
  productExample: string;
  /** Sistemas de precios al crear la empresa (se cambian en Configuración › Sistemas de precios). */
  pricing: { retailAutoEnabled: boolean; wholesaleEnabled: boolean };
};

export const BUSINESS_PROFILES: Record<BusinessType, BusinessProfile> = {
  cosmetics: {
    label: "Cosmética y belleza",
    description: "Productos de cuidado de la piel, maquillaje y belleza.",
    categories: ["Limpieza", "Tónicos", "Sérums y ampollas", "Cremas", "Protectores solares", "Mascarillas y accesorios", "Maquillaje"],
    attributes: [{ name: "Tamaño", example: "Ej.: 50 ml" }],
    productExample: "Ej.: Centella Toning Toner",
    pricing: { retailAutoEnabled: false, wholesaleEnabled: false },
  },
  electronics: {
    label: "Celulares y tecnología",
    description: "Celulares, accesorios, audio y cargadores.",
    categories: ["Celulares", "Accesorios", "Audio", "Cargadores y cables"],
    attributes: [
      { name: "Memoria", example: "Ej.: 128 GB" },
      { name: "Color", example: "Ej.: Negro" },
    ],
    productExample: "Ej.: Samsung Galaxy A55",
    pricing: { retailAutoEnabled: false, wholesaleEnabled: false },
  },
  general: {
    label: "Otro tipo de negocio",
    description: "Configuración básica, sin categorías predefinidas.",
    categories: [],
    attributes: [],
    productExample: "Ej.: Nombre del producto",
    pricing: { retailAutoEnabled: false, wholesaleEnabled: false },
  },
};

export const isBusinessType = (v: unknown): v is BusinessType => typeof v === "string" && (BUSINESS_TYPES as readonly string[]).includes(v);
export const profileOf = (v: string | null | undefined): BusinessProfile => BUSINESS_PROFILES[isBusinessType(v) ? v : "general"];
