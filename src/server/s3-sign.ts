import { createHash, createHmac } from "node:crypto";

// Firma AWS Signature Version 4 para URLs prefirmadas (query string), suficiente para PUT/GET/DELETE de objetos
// en cualquier almacenamiento compatible con S3 (AWS S3, Cloudflare R2, Backblaze B2, MinIO). Sin dependencias:
// solo node:crypto. Verificada con el ejemplo oficial de AWS (tests/unit/s3-sign.test.ts).

export type S3Credentials = { accessKeyId: string; secretAccessKey: string; region: string };

const sha256Hex = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** Codificación URI de SigV4: todo menos A-Z a-z 0-9 - _ . ~ (y "/" en la ruta). */
export function uriEncode(value: string, keepSlash = false) {
  return Array.from(new TextEncoder().encode(value))
    .map((b) => {
      const c = String.fromCharCode(b);
      if (/[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === "/")) return c;
      return `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
}

const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * URL prefirmada. `url` debe incluir el bucket (estilo ruta: https://host/bucket/key, o virtual: https://bucket.host/key).
 * La carga útil no se firma (UNSIGNED-PAYLOAD), como es habitual en URLs prefirmadas.
 */
export function presignUrl(opts: { method: "GET" | "PUT" | "DELETE"; url: string; credentials: S3Credentials; expiresSeconds: number; now?: Date }): string {
  const u = new URL(opts.url);
  const now = opts.now ?? new Date();
  const date = amzDate(now);
  const day = date.slice(0, 8);
  const scope = `${day}/${opts.credentials.region}/s3/aws4_request`;
  const params: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${opts.credentials.accessKeyId}/${scope}`],
    ["X-Amz-Date", date],
    ["X-Amz-Expires", String(opts.expiresSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = params
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalPath = uriEncode(decodeURIComponent(u.pathname), true);
  const canonicalRequest = [opts.method, canonicalPath, canonicalQuery, `host:${u.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${opts.credentials.secretAccessKey}`, day);
  const kRegion = hmac(kDate, opts.credentials.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return `${u.origin}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
