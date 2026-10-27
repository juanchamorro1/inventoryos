import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  integer,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, orgId } from "./columns";

export type OrganizationSettings = {
  lowStockAlerts?: boolean;
};

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    currency: text("currency").notNull().default("COP"),
    timezone: text("timezone").notNull().default("America/Bogota"),
    plan: text("plan").notNull().default("free"),
    settings: jsonb("settings").$type<OrganizationSettings>().notNull().default({}),
    isDemo: boolean("is_demo").notNull().default(false),
    /** Tipo de negocio (cosmetics | electronics | general): adapta categorías, formularios y precios. */
    businessType: text("business_type").notNull().default("general"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("organizations_slug_uq").on(t.slug),
    check("organizations_business_type_ck", sql`${t.businessType} in ('cosmetics','electronics','general')`),
    check("organizations_plan_ck", sql`${t.plan} in ('free','pro','enterprise')`),
    check("organizations_currency_ck", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // Bloqueo de la cuenta en toda la plataforma (solo administradores de plataforma). is_active = false ⇔ bloqueada.
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockedReason: text("blocked_reason"),
    createdAt: createdAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
    check("users_blocked_ck", sql`${t.isActive} = (${t.blockedAt} is null)`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeOrganizationId: uuid("active_organization_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    email: text("email").notNull(),
    ip: text("ip"),
    success: boolean("success").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_email_idx").on(t.email, t.createdAt), index("login_attempts_ip_idx").on(t.ip, t.createdAt)],
);

export const ROLES = ["owner", "admin", "manager", "staff", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const memberships = pgTable(
  "memberships",
  {
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index("memberships_user_idx").on(t.userId),
    check("memberships_role_ck", sql`${t.role} in ('owner','admin','manager','staff','viewer')`),
    check("memberships_status_ck", sql`${t.status} in ('active','disabled')`),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").array().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_org_idx").on(t.organizationId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorApiKeyId: uuid("actor_api_key_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt)],
);

export const documentSequences = pgTable(
  "document_sequences",
  {
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    nextValue: bigint("next_value", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    scope: text("scope").notNull(),
    resultId: text("result_id"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.key] }),
    check("idempotency_key_len_ck", sql`length(${t.key}) between 8 and 200`),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// Archivos subidos (imágenes de productos). Se guardan en PostgreSQL para que la app funcione en
// plataformas sin disco persistente (p. ej. Vercel). Protegidos por RLS como el resto de datos.
export const storedFiles = pgTable(
  "stored_files",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("stored_files_org_idx").on(t.organizationId), check("stored_files_size_ck", sql`${t.size} > 0 and ${t.size} <= 2097152`)],
);

export const INVITATION_STATUSES = ["pending", "accepted", "revoked"] as const;

// Invitaciones a una empresa. El enlace lleva un token aleatorio; aquí solo se guarda su SHA-256.
// La persona invitada acepta con su propia cuenta (o crea una con su propia contraseña).
export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<Role>().notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").$type<(typeof INVITATION_STATUSES)[number]>().notNull().default("pending"),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Emitida por un administrador de plataforma (p. ej. el dueño de una empresa creada desde Plataforma). */
    platformIssued: boolean("platform_issued").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_uq").on(t.tokenHash),
    // Una sola invitación pendiente por correo y empresa.
    uniqueIndex("invitations_pending_email_uq").on(t.organizationId, sql`lower(${t.email})`).where(sql`${t.status} = 'pending'`),
    index("invitations_org_idx").on(t.organizationId, t.createdAt),
    check("invitations_role_ck", sql`${t.role} in ('owner','admin','manager','staff','viewer')`),
    check("invitations_status_ck", sql`${t.status} in ('pending','accepted','revoked')`),
    check("invitations_email_ck", sql`${t.email} = lower(${t.email})`),
  ],
);

// Restablecimiento de contraseña. El token solo viaja en el enlace; aquí se guarda su SHA-256.
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    // self: lo pidió la persona (formulario público); platform: lo generó un administrador de plataforma.
    origin: text("origin").$type<"self" | "platform">().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("password_reset_tokens_hash_uq").on(t.tokenHash),
    index("password_reset_tokens_user_idx").on(t.userId, t.createdAt),
    check("password_reset_tokens_origin_ck", sql`${t.origin} in ('self','platform')`),
  ],
);

// Administradores de la plataforma (operadores de InventoryOS, no de una empresa). La aplicación solo
// puede LEER esta tabla: se otorga y retira únicamente con `npm run platform:admin` usando el rol dueño.
export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  grantedAt: createdAt(),
  note: text("note"),
});

// Auditoría de acciones de plataforma y de seguridad de cuentas (solo inserción).
export const platformAuditLogs = pgTable(
  "platform_audit_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("platform_audit_logs_target_idx").on(t.targetUserId, t.createdAt)],
);

// Contadores de ventana fija para limitar solicitudes. La clave es un SHA-256 (no guarda correos ni IP en claro).
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("rate_limits_window_idx").on(t.windowStart)],
);
