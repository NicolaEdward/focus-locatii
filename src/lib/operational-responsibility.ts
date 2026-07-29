import type { Prisma } from "@prisma/client";

type UserReference = {
  id: string;
  name?: string | null;
};

type ClientOwnership = {
  accountOwnerUserId?: string | null;
  accountOwner?: UserReference | null;
};

type OperationalResponsibilitySource = {
  reservation?: {
    client?: ClientOwnership | null;
    campaign?: { client?: ClientOwnership | null } | null;
  } | null;
  campaign?: { client?: ClientOwnership | null } | null;
};

export type OperationalBusinessOwner = {
  id: string;
  name: string | null;
};

// Business responsibility follows the client relationship; OperationTask.assignedToUserId remains the field executor.
export function operationalBusinessOwner(
  source: OperationalResponsibilitySource
): OperationalBusinessOwner | null {
  return clientBusinessOwner(source.campaign?.client)
    || clientBusinessOwner(source.reservation?.campaign?.client)
    || clientBusinessOwner(source.reservation?.client)
    || null;
}

export function operationalBusinessOwnerWhere(ownerUserId: string): Prisma.OperationTaskWhereInput {
  return {
    OR: [
      {
        campaign: {
          is: {
            client: { is: { accountOwnerUserId: ownerUserId } }
          }
        }
      },
      {
        campaignId: null,
        reservation: {
          is: {
            campaign: {
              is: {
                client: { is: { accountOwnerUserId: ownerUserId } }
              }
            }
          }
        }
      },
      {
        campaignId: null,
        reservation: {
          is: {
            campaignId: null,
            client: { is: { accountOwnerUserId: ownerUserId } }
          }
        }
      }
    ]
  };
}

export function operationalBusinessOwnerAssignedWhere(): Prisma.OperationTaskWhereInput {
  return {
    OR: [
      {
        campaign: {
          is: {
            client: { is: { accountOwnerUserId: { not: null } } }
          }
        }
      },
      {
        campaignId: null,
        reservation: {
          is: {
            campaign: {
              is: {
                client: { is: { accountOwnerUserId: { not: null } } }
              }
            }
          }
        }
      },
      {
        campaignId: null,
        reservation: {
          is: {
            campaignId: null,
            client: { is: { accountOwnerUserId: { not: null } } }
          }
        }
      }
    ]
  };
}

function clientBusinessOwner(client: ClientOwnership | null | undefined): OperationalBusinessOwner | null {
  const id = client?.accountOwnerUserId || client?.accountOwner?.id || null;
  if (!id) return null;
  return {
    id,
    name: client?.accountOwner?.name || null
  };
}
