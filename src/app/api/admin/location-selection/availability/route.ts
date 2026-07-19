import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { getLocationSelectionAvailability } from "@/lib/location-selection-availability";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const availabilitySchema = z.object({
  locationIds: z.array(z.string().trim().min(1)).max(500),
  periodStart: z.string().trim().optional().nullable(),
  periodEnd: z.string().trim().optional().nullable()
});

export async function POST(request: NextRequest) {
  return observeRoute(request, {
    route: "/api/admin/location-selection/availability",
    operation: "selector.availability",
    budgetKey: "selector_availability_api"
  }, async () => {
    const { session, response } = await requirePermission(request, "inventory.view");
    if (response || !session) return response;
    setObservabilityRole(session.role);

    try {
      const input = availabilitySchema.parse(await request.json());
      const availabilityByLocationId = await getLocationSelectionAvailability({
        locationIds: input.locationIds,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        session
      });
      return NextResponse.json({ ok: true, availabilityByLocationId }, { headers: noStoreHeaders });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Disponibilitatea nu a putut fi verificata." },
        { status: 400, headers: noStoreHeaders }
      );
    }
  });
}
