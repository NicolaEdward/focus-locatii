export const CAMPAIGN_STATUSES = [
  "draft",
  "planned",
  "active",
  "completed",
  "cancelled",
  "archived"
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const campaignStatusSet = new Set<string>(CAMPAIGN_STATUSES);
const campaignTransitions: Record<CampaignStatus, ReadonlySet<CampaignStatus>> = {
  draft: new Set(["draft", "planned", "active", "cancelled", "archived"]),
  planned: new Set(["planned", "draft", "active", "cancelled", "archived"]),
  active: new Set(["active", "planned", "completed", "cancelled", "archived"]),
  completed: new Set(["completed", "active", "archived"]),
  cancelled: new Set(["cancelled", "draft", "planned", "archived"]),
  archived: new Set(["archived"])
};

export function parseCampaignStatus(value: unknown): CampaignStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!campaignStatusSet.has(normalized)) {
    throw new Error("Status de campanie invalid.");
  }
  return normalized as CampaignStatus;
}

export function assertCampaignStatusForCreate(status: CampaignStatus) {
  if (status === "archived" || status === "completed") {
    throw new Error("O campanie noua nu poate fi creata direct ca finalizata sau arhivata.");
  }
}

export function assertCampaignStatusTransition(currentValue: unknown, nextValue: unknown) {
  const current = parseCampaignStatus(currentValue);
  const next = parseCampaignStatus(nextValue);
  if (!campaignTransitions[current].has(next)) {
    throw new Error(`Tranzitia campaniei din ${current} in ${next} nu este permisa.`);
  }
  return next;
}

export function allowedCampaignTransitions(currentValue: unknown) {
  const current = parseCampaignStatus(currentValue);
  return [...campaignTransitions[current]];
}
