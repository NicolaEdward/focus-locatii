import type { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { ClientMutationError } from "@/lib/clients";

export type CampaignParties = {
  clientId: string;
  campaignType: string;
  agencyClientId: string | null;
  endClientId: string | null;
};

/** clientId remains the contractual / invoiced client; agency and beneficiary are explicit, independent roles. */
export function resolveCampaignParties(input: Partial<CampaignParties>, existing?: CampaignParties): CampaignParties {
  return {
    clientId: input.clientId ?? existing?.clientId ?? "",
    campaignType: input.campaignType ?? existing?.campaignType ?? "direct_client",
    agencyClientId: input.agencyClientId === undefined ? existing?.agencyClientId ?? null : input.agencyClientId,
    endClientId: input.endClientId === undefined ? existing?.endClientId ?? null : input.endClientId,
  };
}

export function campaignPartyIds(parties: CampaignParties) {
  return [...new Set([parties.clientId, parties.agencyClientId, parties.endClientId].filter((id): id is string => Boolean(id)))].sort();
}

export function campaignPartyFingerprint(parties: CampaignParties) {
  return JSON.stringify([parties.clientId, parties.campaignType, parties.agencyClientId, parties.endClientId]);
}

export async function assertCampaignParties(
  tx: Pick<Prisma.TransactionClient, "clientAccount">,
  parties: CampaignParties,
  actor?: Pick<AuthSession, "role" | "id"> | null,
  options: { requireCompleteAgency?: boolean } = {},
) {
  if (parties.campaignType === "direct_client") {
    if (parties.agencyClientId || parties.endClientId && parties.endClientId !== parties.clientId) {
      throw new ClientMutationError("O campanie directă nu poate avea o agenție sau un beneficiar diferit de clientul contractual. Alege tipul Prin agenție pentru această relație.", 400);
    }
  } else if (parties.campaignType === "agency") {
    if (parties.agencyClientId && parties.agencyClientId === parties.endClientId) {
      throw new ClientMutationError("Agenția și beneficiarul final trebuie să fie clienți diferiți.", 400);
    }
    if (options.requireCompleteAgency && (!parties.agencyClientId || !parties.endClientId)) {
      throw new ClientMutationError("Completează agenția și beneficiarul final în dosarul campaniei înainte de confirmarea sau modificarea comercială a închirierii.", 409);
    }
  } else {
    throw new ClientMutationError("Tipul campaniei nu este recunoscut. Verifică dosarul comercial.", 409);
  }
  const ids = campaignPartyIds(parties);
  const rows = await tx.clientAccount.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, accountOwnerUserId: true },
  });
  if (rows.length !== ids.length || rows.some((row) => ["archived", "merged"].includes(row.status) || actor?.role === "SALES_AGENT" && row.accountOwnerUserId !== actor.id)) {
    // Do not distinguish nonexistent clients from another seller's portfolio.
    throw new ClientMutationError("Clientul contractual, agenția sau beneficiarul final nu este disponibil în portofoliul autorizat. Un manager trebuie să verifice asocierea.", 403);
  }
}
