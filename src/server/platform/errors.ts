export type FieldErrors = Record<string, string[]>;

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly fieldErrors: FieldErrors = {},
  ) {
    super(message, "validation_error", 422);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "El recurso no existe o no tienes acceso a él.") {
    super(message, "not_found", 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "No tienes permiso para realizar esta acción.") {
    super(message, "forbidden", 403);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Debes iniciar sesión.") {
    super(message, "unauthenticated", 401);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "conflict") {
    super(message, code, 409);
  }
}

export class InsufficientStockError extends ConflictError {
  constructor(
    readonly details: { sku: string; location: string; available: string; requested: string },
  ) {
    super(
      `Stock insuficiente: de ${details.sku} hay ${details.available} en ${details.location} y estás intentando sacar ${details.requested}.`,
      "insufficient_stock",
    );
  }
}

export class PlanLimitError extends AppError {
  constructor(message: string) {
    super(message, "plan_limit", 402);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.") {
    super(message, "rate_limited", 429);
  }
}

type PgLikeError = { code?: string; constraint?: string; cause?: unknown; message?: string };

/** Devuelve el error de PostgreSQL original (drizzle lo envuelve en DrizzleQueryError.cause). */
export function pgError(err: unknown): PgLikeError | undefined {
  let current: unknown = err;
  for (let i = 0; i < 5 && current && typeof current === "object"; i++) {
    const e = current as PgLikeError;
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    current = e.cause;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown, constraint?: string) => {
  const e = pgError(err);
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
};
