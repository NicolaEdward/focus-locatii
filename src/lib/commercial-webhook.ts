import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  CommercialError,
  commercialHash,
  normalizeRecipient,
  tokenHash,
} from "@/lib/commercial-workbench-core";

export function verifyCommercialWebhook(
  raw: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
) {
  const eventId = headers.get("svix-id") || "",
    timestamp = headers.get("svix-timestamp") || "",
    signature = headers.get("svix-signature") || "";
  if (
    !/^[A-Za-z0-9_-]{1,191}$/.test(eventId) ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000 ||
    !secret.startsWith("whsec_")
  )
    throw new CommercialError("WEBHOOK_INVALID", "Semnătură invalidă.", 401);
  const key = Buffer.from(secret.slice(6), "base64");
  if (key.length < 24)
    throw new CommercialError(
      "WEBHOOK_CONFIG_INVALID",
      "Secretul de verificare nu este configurat.",
      503,
    );
  const expected = createHmac("sha256", key)
    .update(eventId + "." + timestamp + "." + raw)
    .digest();
  const valid = signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const supplied = Buffer.from(value, "base64");
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  });
  if (!valid)
    throw new CommercialError("WEBHOOK_INVALID", "Semnătură invalidă.", 401);
  return eventId;
}
const payloadSchema = z
  .object({
    type: z.enum(["email.delivered", "email.bounced", "email.complained"]),
    data: z.object({ email_id: z.string().min(1).max(191) }).passthrough(),
  })
  .passthrough();
export async function applyCommercialDeliveryEvent(
  eventId: string,
  raw: unknown,
) {
  const input = payloadSchema.parse(raw),
    hash = commercialHash(input);
  return prisma.$transaction(
    async (tx) => {
      const previous = await tx.commercialDeliveryEvent.findUnique({
        where: { eventId },
      });
      if (previous) {
        if (previous.payloadHash !== hash)
          throw new CommercialError(
            "WEBHOOK_REPLAY_CONFLICT",
            "Eveniment incompatibil.",
            409,
          );
        return { replayed: true };
      }
      const dispatch = await tx.commercialDispatch.findFirst({
        where: { providerReceipt: input.data.email_id },
      });
      if (!dispatch)
        throw new CommercialError(
          "DISPATCH_NOT_FOUND",
          "Expedierea nu este încă reconciliată.",
          409,
        );
      await tx.$queryRaw`SELECT id FROM portfolio_commercial_dispatches WHERE id = ${dispatch.id} FOR UPDATE`;
      const live = await tx.commercialDispatch.findUniqueOrThrow({
        where: { id: dispatch.id },
      });
      // A late delivered event cannot erase a bounce or complaint.
      const state =
        input.type === "email.complained"
          ? "complained"
          : input.type === "email.bounced"
            ? "bounced"
            : ["bounced", "complained"].includes(live.state)
              ? live.state
              : "delivered";
      await tx.commercialDispatch.update({
        where: { id: live.id },
        data: { state },
      });
      if (state === "bounced" || state === "complained")
        await tx.commercialSuppression.upsert({
          where: {
            recipientHash: tokenHash(normalizeRecipient(live.recipient)),
          },
          create: {
            recipientHash: tokenHash(normalizeRecipient(live.recipient)),
            reason: "provider:" + state,
            createdByUserId: live.requestedByUserId,
          },
          update: { reason: "provider:" + state },
        });
      await tx.commercialDeliveryEvent.create({
        data: {
          eventId,
          dispatchId: live.id,
          eventType: input.type,
          payloadHash: hash,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: live.requestedByUserId,
          action: "commercial.dispatch.delivery",
          entityType: "commercial_dispatch",
          entityId: live.id,
          metadata: {
            durability: "business-transaction",
            eventId,
            state,
            payloadHash: hash,
          },
        },
      });
      return { replayed: false, state };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
