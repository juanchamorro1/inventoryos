import type { Role } from "../db/schema";

/** Contexto de ejecución: siempre se construye en el servidor a partir de la sesión o de una clave API. */
export type TenantContext = {
  organizationId: string;
  /** Usuario responsable. Para claves API es el usuario que creó la clave. */
  userId: string;
  role: Role;
  actor: { type: "user" } | { type: "api_key"; apiKeyId: string; scopes: string[] };
};
