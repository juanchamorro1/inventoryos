import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../../db/client";
import { locations, loginAttempts, memberships, organizations, sessions, taxRates, users, warehouses, type Role } from "../../db/schema";
import { setTxSetting, withGlobalTx, withTenantTx, withUserTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { ForbiddenError, isUniqueViolation, NotFoundError, RateLimitError, UnauthenticatedError, ValidationError } from "../../platform/errors";
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from "./password";

export const SESSION_TTL_DAYS = 7;
const MAX_FAILED_PER_EMAIL = 5;
const MAX_FAILED_PER_IP = 30;
const WINDOW_MINUTES = 15;

const emailSchema = z.string().trim().toLowerCase().email("Correo electrónico inválido.").max(254);

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre.").max(120),
  email: emailSchema,
  password: z.string(),
  organizationName: z.string().trim().min(2, "Escribe el nombre de la empresa.").max(120),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Moneda inválida (código ISO, p. ej. COP).")
    .default("COP"),
});

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function slugify(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "empresa"}-${randomBytes(3).toString("hex")}`;
}

/** Crea la empresa con su configuración inicial y al usuario como propietario. */
export async function createOrganization(
  tx: Tx,
  input: { userId: string; name: string; currency?: string; isDemo?: boolean },
): Promise<string> {
  const organizationId = randomUUID();
  await setTxSetting(tx, "app.org_id", organizationId);
  await setTxSetting(tx, "app.user_id", input.userId);
  await tx.insert(organizations).values({
    id: organizationId,
    name: input.name,
    slug: slugify(input.name),
    currency: input.currency ?? "COP",
    isDemo: input.isDemo ?? false,
  });
  await tx.insert(memberships).values({ organizationId, userId: input.userId, role: "owner" });
  const [wh] = await tx
    .insert(warehouses)
    .values({ organizationId, code: "PRINCIPAL", name: "Bodega principal", isDefault: true })
    .returning({ id: warehouses.id });
  await tx.insert(locations).values({ organizationId, warehouseId: wh!.id, code: "GENERAL", name: "General", isDefault: true });
  await tx.insert(taxRates).values([
    { organizationId, name: "IVA 19%", rate: "19", isDefault: true },
    { organizationId, name: "IVA 5%", rate: "5" },
    { organizationId, name: "Exento", rate: "0" },
  ]);
  const ctx: TenantContext = { organizationId, userId: input.userId, role: "owner", actor: { type: "user" } };
  await audit(tx, ctx, "organization.created", { type: "organization", id: organizationId }, { name: input.name });
  return organizationId;
}

export async function registerOwner(raw: unknown): Promise<{ userId: string; organizationId: string }> {
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Revisa los datos del formulario.", z.flattenError(parsed.error).fieldErrors);
  const problem = passwordProblem(parsed.data.password);
  if (problem) throw new ValidationError(problem, { password: [problem] });
  const passwordHash = await hashPassword(parsed.data.password);
  try {
    return await withGlobalTx(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: parsed.data.email, name: parsed.data.name, passwordHash })
        .returning({ id: users.id });
      const organizationId = await createOrganization(tx, {
        userId: user!.id,
        name: parsed.data.organizationName,
        currency: parsed.data.currency,
      });
      return { userId: user!.id, organizationId };
    });
  } catch (err) {
    if (isUniqueViolation(err, "users_email_uq")) {
      throw new ValidationError("Ya existe una cuenta con ese correo.", { email: ["Ya existe una cuenta con ese correo."] });
    }
    throw err;
  }
}

/** Verifica credenciales con límite de intentos por correo e IP. Mensaje genérico ante cualquier fallo. */
export async function authenticate(rawEmail: string, password: string, ip: string | null): Promise<string> {
  const email = rawEmail.trim().toLowerCase();
  const since = sql`now() - make_interval(mins => ${WINDOW_MINUTES})`;
  const [byEmail] = await withGlobalTx((tx) =>
    tx
      .select({ n: count() })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.email, email), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since))),
  );
  const [byIp] = ip
    ? await withGlobalTx((tx) =>
        tx
          .select({ n: count() })
          .from(loginAttempts)
          .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since))),
      )
    : [{ n: 0 }];
  if ((byEmail?.n ?? 0) >= MAX_FAILED_PER_EMAIL || (byIp?.n ?? 0) >= MAX_FAILED_PER_IP) throw new RateLimitError();

  const [user] = await withGlobalTx((tx) =>
    tx.select().from(users).where(sql`lower(${users.email}) = ${email}`),
  );
  const ok = user ? await verifyPassword(password, user.passwordHash) : (await verifyPassword(password, await dummyHash()), false);
  const success = Boolean(ok && user?.isActive);
  await withGlobalTx(async (tx) => {
    await tx.insert(loginAttempts).values({ email, ip, success });
    if (success) await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user!.id));
  });
  if (!success) throw new UnauthenticatedError("Correo o contraseña incorrectos.");
  return user!.id;
}

export async function listUserOrganizations(userId: string) {
  return withUserTx(userId, (tx) =>
    tx
      .select({ id: organizations.id, name: organizations.name, role: memberships.role, isDemo: organizations.isDemo })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(asc(organizations.name)),
  );
}

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const orgs = await listUserOrganizations(userId);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await withGlobalTx((tx) =>
    tx.insert(sessions).values({
      tokenHash: hashToken(token),
      userId,
      activeOrganizationId: orgs[0]?.id ?? null,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    }),
  );
  return { token, expiresAt };
}

export type SessionInfo = {
  tokenHash: string;
  activeOrganizationId: string | null;
  user: { id: string; name: string; email: string };
};

export async function resolveSession(token: string | undefined): Promise<SessionInfo | null> {
  if (!token || token.length > 100) return null;
  const tokenHash = hashToken(token);
  const [row] = await withGlobalTx((tx) =>
    tx
      .select({
        tokenHash: sessions.tokenHash,
        activeOrganizationId: sessions.activeOrganizationId,
        expiresAt: sessions.expiresAt,
        userId: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash)),
  );
  if (!row || row.expiresAt < new Date() || !row.isActive) return null;
  return {
    tokenHash: row.tokenHash,
    activeOrganizationId: row.activeOrganizationId,
    user: { id: row.userId, name: row.name, email: row.email },
  };
}

export async function deleteSession(token: string) {
  await withGlobalTx((tx) => tx.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))));
}

export async function setActiveOrganization(session: SessionInfo, organizationId: string) {
  await buildTenantContext(session.user.id, organizationId); // valida membresía activa
  await withGlobalTx((tx) =>
    tx.update(sessions).set({ activeOrganizationId: organizationId }).where(eq(sessions.tokenHash, session.tokenHash)),
  );
}

/** Construye el contexto verificando en la base de datos que la membresía está activa. */
export async function buildTenantContext(userId: string, organizationId: string): Promise<TenantContext> {
  const [m] = await withTenantTx({ organizationId, userId }, (tx) =>
    tx
      .select({ role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId))),
  );
  if (!m) throw new NotFoundError("No perteneces a esta empresa.");
  if (m.status !== "active") throw new ForbiddenError("Tu acceso a esta empresa está desactivado.");
  return { organizationId, userId, role: m.role as Role, actor: { type: "user" } };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, keepTokenHash?: string) {
  const problem = passwordProblem(newPassword);
  if (problem) throw new ValidationError(problem, { newPassword: [problem] });
  const [user] = await withGlobalTx((tx) => tx.select().from(users).where(eq(users.id, userId)));
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ValidationError("La contraseña actual no es correcta.", { currentPassword: ["La contraseña actual no es correcta."] });
  }
  const passwordHash = await hashPassword(newPassword);
  await withGlobalTx(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    // Cierra las demás sesiones del usuario.
    await tx.execute(sql`delete from sessions where user_id = ${userId} and token_hash <> ${keepTokenHash ?? ""}`);
  });
}

export { emailSchema };
