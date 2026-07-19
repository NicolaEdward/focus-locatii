import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { observeRoute } from "@/lib/observability";

export async function GET(request: NextRequest) {
  return observeRoute(request, { route: "/api/health/db", operation: "health.db" }, async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ ok: false, error: "Serviciul de date nu este disponibil." }, { status: 503 });
    }
  });
}
