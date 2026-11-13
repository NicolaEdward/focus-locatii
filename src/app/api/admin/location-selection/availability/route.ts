import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { getLocationSelectionAvailability } from "@/lib/location-selection-availability";
import { observeRoute, setObservabilityRole } from "@/lib/observability";
import { resolveQuoteHoldContext } from "@/lib/quote-hold-context";
import { CommercialError } from "@/lib/commercial-workbench-core";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, proxy-revalidate",
  Vary: "Cookie"
};

const availabilitySchema = z.object({
  locationIds: z.array(z.string().trim().min(1)).max(500),
  periodStart: z.string().trim().optional().nullable(),
  periodEnd: z.string().trim().optional().nullable(),
  quoteId: z.string().trim().min(1).max(191).optional(),
  expectedRevision: z.number().int().positive().optional(),
}).strict().superRefine((input, ctx) => {
  if (Boolean(input.quoteId) !== (input.expectedRevision !== undefined)) ctx.addIssue({ code: "custom", message: "Contextul ofertei cere identificatorul și versiunea exactă." });
  if (input.quoteId && (!input.periodStart || !input.periodEnd || !input.locationIds.length || input.locationIds.length > 50)) ctx.addIssue({ code: "custom", message: "Contextul ofertei cere perioada completă și selecția exactă de maximum 50 de locații." });
});

export async function POST(request: NextRequest) {
  return observeRoute(request, {
    route: "/api/admin/location-selection/availability",
    operation: "selector.availability",
    budgetKey: "selector_availability_api"
  }, async () => {
    const { session, response } = await requirePermission(request, "inventory.view");
    if (response || !session) {
      if (response) for (const [key, value] of Object.entries(noStoreHeaders)) response.headers.set(key, value);
      return response;
    }
    setObservabilityRole(session.role);

    try {
      const input = availabilitySchema.parse(await request.json());
      const quoteHold = input.quoteId ? await resolveQuoteHoldContext({
        quoteId: input.quoteId, expectedRevision: input.expectedRevision, actor: session,
        locationIds: input.locationIds, periodStart: input.periodStart!, periodEnd: input.periodEnd!,
      }) : null;
      const availabilityByLocationId = await getLocationSelectionAvailability({
        locationIds: input.locationIds,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        session,
        ignoreReservationIds: quoteHold?.reservationIds,
      });
      if (quoteHold?.reservationIds.length) for (const row of quoteHold.rows) {
        const availability = availabilityByLocationId[row.locationId];
        if (availability?.state === "AVAILABLE") {
          availability.label = "HOLD al acestei oferte";
          availability.explanation = "HOLD-ul existent al acestei oferte este păstrat. Revizuirea ciornei nu modifică rezervarea; actualizarea ei cere o aprobare nouă.";
          availability.warnings = [...new Set([availability.explanation, ...availability.warnings])];
        }
      }
      return NextResponse.json({ ok: true, availabilityByLocationId, ...(quoteHold ? { quoteHoldContext: { quoteId: quoteHold.quoteId, expectedRevision: quoteHold.expectedRevision, count: quoteHold.reservationIds.length } } : {}) }, { headers: noStoreHeaders });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Disponibilitatea nu a putut fi verificata.", ...(error instanceof CommercialError ? { code: error.code } : {}) },
        { status: error instanceof CommercialError ? error.status : 400, headers: noStoreHeaders }
      );
    }
  });
}
