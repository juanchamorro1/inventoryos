import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt (memoria intensiva) de la biblioteca estándar de Node: sin criptografía propia.
const N = 2 ** 15;
const r = 8;
const p = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (password.length > PASSWORD_MAX) return `La contraseña no puede superar ${PASSWORD_MAX} caracteres.`;
  if (!/[a-zA-ZÀ-ÿ]/.test(password) || !/\d/.test(password)) return "La contraseña debe combinar letras y números.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, rr, pp, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
    maxmem: MAXMEM,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hash ficticio para igualar el tiempo de respuesta cuando el correo no existe. */
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword("dummy-password-0"));

/** Contraseña aleatoria legible para altas iniciales (se muestra una sola vez). */
export function generatePassword(): string {
  return `${randomBytes(9).toString("base64url")}9a`;
}
