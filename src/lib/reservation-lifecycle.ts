import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditActor } from "@/lib/audit";
import {
  HOLD_DURATION_DAYS,
  effectiveHoldExpiresAt,
  holdExpirationFrom,
  isEffectiveBlockingReservation,
  isEffectiveHold
} from "@/lib/reservation-lifecycle-domain";

export {
  HOLD_DURATION_DAYS,
  effectiveHoldExpiresAt,
  holdExpirationFrom,
  isEffectiveBlockingReservation,
  isEffectiveHold
} from "@/lib/reservation-lifecycle-domain";

const holdStatuses = ["HOLD", "RESERVED"] as const;

export function effectiveHoldWhere(now = new Date()): Prisma.ReservationWhereInput {
  const legacyCutoff = holdLegacyCutoff(now);
  return {
    status: { in: [...holdStatuses] },
    OR: [
      { holdExpiresAt: { gt: now } },
      { holdExpiresAt: null, createdAt: { gt: legacyCutoff } }
    ]
  };
}

export function effectiveBlockingReservationWhere(now = new Date()): Prisma.ReservationWhereInput {
  return {
    OR: [
      { status: "BOOKED" },
      effectiveHoldWhere(now)
    ]
  };
}

export function reservationLifecycleData(status: string, existingBookedAt?: Date | null, now = new Date()) {
  if (status === "BOOKED") {
    return {
      bookedAt: existingBookedAt || now,
      holdExpiresAt: null
    };
  }

  if (holdStatuses.includes(status as (typeof holdStatuses)[number])) {
    return {
      bookedAt: null,
      holdExpiresAt: holdExpirationFrom(now)
    };
  }

  return {
    holdExpiresAt: null
  };
}

export async function expireStaleHolds(now = new Date()) {
  return expireStaleHoldsCommand({ now });
}

export async function expireStaleHoldsCommand(input: {
  now?: Date;
  actor?: AuditActor | null;
} = {}) {
  const now = input.now || new Date();
  const legacyCutoff = holdLegacyCutoff(now);

  const result = await prisma.$transaction(async (tx) => {
    const eligible = await tx.reservation.findMany({
      where: staleHoldWhere(now, legacyCutoff),
      select: { id: true, status: true, holdExpiresAt: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    if (!eligible.length) return { count: 0, reservationIds: [] as string[] };

    const reservationIds = eligible.map((reservation) => reservation.id);
    const update = await tx.reservation.updateMany({
      where: {
        id: { in: reservationIds },
        ...staleHoldWhere(now, legacyCutoff)
      },
      data: {
        status: "EXPIRED",
        holdExpiresAt: null
      }
    });

    return { count: update.count, reservationIds };
  });

  if (result.count > 0) {
    await recordAudit({
      actor: input.actor || null,
      action: "reservation.holds_expired",
      entityType: "reservation",
      metadata: {
        reservationIds: result.reservationIds,
        count: result.count,
        expiredAt: now.toISOString()
      }
    });
  }

  return result.count;
}

function holdLegacyCutoff(now: Date) {
  const legacyCutoff = new Date(now);
  legacyCutoff.setUTCDate(legacyCutoff.getUTCDate() - HOLD_DURATION_DAYS);
  return legacyCutoff;
}

function staleHoldWhere(now: Date, legacyCutoff: Date) {
  return {
    status: { in: [...holdStatuses] },
    OR: [
      { holdExpiresAt: { lte: now } },
      { holdExpiresAt: null, createdAt: { lte: legacyCutoff } }
    ]
  };
}
