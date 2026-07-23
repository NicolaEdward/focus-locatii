import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { observeRoute, setObservabilityRole } from "@/lib/observability";
import { searchReceivableOptions } from "@/lib/receivables-workspace-service";

export const dynamic = "force-dynamic";

const optionType = z.enum(["clients", "campaigns", "locations", "receivables"]);

export async function GET(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/receivables-workspace/options", operation: "receivables.options" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["finance.validate", "finance.manage"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    const parsed = optionType.safeParse(request.nextUrl.searchParams.get("type"));
    if (!parsed.success) return NextResponse.json({ error: "Tipul opțiunii este invalid." }, { status: 400 });
    const items = await searchReceivableOptions({
      type: parsed.data,
      query: request.nextUrl.searchParams.get("q") || "",
      clientId: request.nextUrl.searchParams.get("clientId") || undefined,
      selectedId: request.nextUrl.searchParams.get("selectedId") || undefined,
      take: Number(request.nextUrl.searchParams.get("take") || 20)
    });
    return NextResponse.json({ items });
  });
}
