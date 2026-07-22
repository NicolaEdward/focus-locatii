import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { clearManualAvailabilityOverrides, createManualAvailabilityOverride } from "@/lib/location-availability-overrides";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const bodySchema = z.object({
  blocked: z.boolean(),
  blockedReason: z.string().trim().max(1000).nullable().optional(),
  blockedFrom: z.string().trim().nullable().optional(),
  blockedUntil: z.string().trim().nullable().optional(),
  blockedNotes: z.string().trim().max(2000).nullable().optional()
});

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["inventory.manage", "reservations.manage"]);
  if (response || !session) return response;
  const { id } = await context.params;

  try {
    const input = bodySchema.parse(await request.json());
    const location = await prisma.$transaction(async (tx) => {
      const existing = await tx.location.findUnique({
        where: { id },
        select: { id: true, code: true, blockedReason: true, blockedUntil: true, status: true }
      });
      if (!existing) throw new Error("Locatia nu exista.");

      if (input.blocked) {
        await createManualAvailabilityOverride({
          db: tx,
          locationId: id,
          reason: input.blockedReason || "Blocat operational",
          periodStart: parseDate(input.blockedFrom) || new Date(),
          periodEnd: parseDate(input.blockedUntil),
          notes: input.blockedNotes || null,
          createdByUserId: session.id
        });
      } else {
        await clearManualAvailabilityOverrides({
          db: tx,
          locationId: id,
          clearedByUserId: session.id,
          type: "COMMERCIAL_BLOCK"
        });
        // Compatibility cleanup only: new blocks are stored exclusively as overrides.
        await tx.location.update({
          where: { id },
          data: {
            blockedReason: null,
            blockedByUserId: null,
            blockedFrom: null,
            blockedUntil: null,
            blockedNotes: null
          }
        });
      }

      return existing;
    });

    await recordAudit({
      actor: session,
      action: input.blocked ? "location.block" : "location.unblock",
      entityType: "location",
      entityId: id,
      metadata: { input, location },
      request
    });

    return NextResponse.json({ location }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Locatia nu a putut fi actualizata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
