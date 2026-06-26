import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditActor } from "@/lib/audit";

export const HOLD_DURATION_DAYS = 5;
const holdStatuses = ["HOLD", "RESERVED"] as const;

export function holdExpirationFrom(value = new Date()) {
  const expiresAt = new Date(value);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + HOLD_DURATION_DAYS);
  return expiresAt;
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
  const legacyCutoff = new Date(now);
  legacyCutoff.setUTCDate(legacyCutoff.getUTCDate() - HOLD_DURATION_DAYS);

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

function staleHoldWhere(now: Date, legacyCutoff: Date) {
  return {
    status: { in: [...holdStatuses] },
    OR: [
      { holdExpiresAt: { lte: now } },
      { holdExpiresAt: null, createdAt: { lte: legacyCutoff } }
    ]
  };
}
