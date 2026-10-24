/**
 * Destino tras iniciar sesión. Solo se aceptan rutas internas conocidas (enlaces de invitación) para que
 * el parámetro ?next= no pueda usarse como redirección abierta hacia otro sitio.
 */
export function safeNext(value: unknown): string | null {
  return typeof value === "string" && /^\/invite\/[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
