import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { refreshExchangeRate } from "@/server/modules/exchange/service";

export const dynamic = "force-dynamic";

// Consulta programada de la TRM (Vercel Cron, ver vercel.json). Vercel envía «Authorization: Bearer <CRON_SECRET>».
// Sin CRON_SECRET configurado la ruta está deshabilitada. Solo guarda la tasa global: cada empresa recalcula sus
// precios la próxima vez que se consulta su catálogo (según su política de aprobación).
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET no está configurado." }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ ok: false }, { status: 401 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  const result = await refreshExchangeRate({ trigger: "cron", force });
  const status = result.status === "error" ? 502 : 200;
  return NextResponse.json({ ok: result.status !== "error" && result.status !== "rejected", ...result }, { status, headers: { "Cache-Control": "no-store" } });
}
