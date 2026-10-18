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
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("organizations_slug_uq").on(t.slug),
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
    createdAt: createdAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
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
