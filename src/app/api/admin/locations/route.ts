import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { listAdminLocationPage } from "@/lib/locations";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  return observeRoute(request, {
    route: "/api/admin/locations",
    operation: "admin.locations.page"
  }, async () => {
    const { session, response } = await requirePermission(request, "inventory.view");
    if (response || !session) return response;
    setObservabilityRole(session.role);

    const params = request.nextUrl.searchParams;
    const page = await listAdminLocationPage({
      query: params.get("q"),
      category: params.get("category"),
      lifecycleStatus: params.get("status"),
      page: params.get("page"),
      pageSize: params.get("pageSize")
    });
    return NextResponse.json({ locations: page }, { headers: noStoreHeaders });
  });
}
