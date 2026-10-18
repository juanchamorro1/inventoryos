import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { buildTenantContext } from "@/server/modules/auth/service";
import { exportProductsCsv } from "@/server/modules/catalog/csv";
import { AppError } from "@/server/platform/errors";

export async function GET() {
  const session = await getSession();
  if (!session?.activeOrganizationId) return NextResponse.redirect(new URL("/login", process.env.APP_URL ?? "http://localhost:3100"));
  try {
    const ctx = await buildTenantContext(session.user.id, session.activeOrganizationId);
    const csv = await exportProductsCsv(ctx);
    const date = new Date().toISOString().slice(0, 10);
    // BOM para que Excel reconozca UTF-8 (tildes y ñ).
    return new NextResponse(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="productos-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new NextResponse(err.message, { status: err.status });
    throw err;
  }
}
