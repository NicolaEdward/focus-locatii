export type CrmHandoffTargetType = "client_account" | "campaign";

export type CrmHandoffProposal = {
  opportunityId: string;
  version: number;
  ready: boolean;
  stage: string;
  company: {
    name: string;
    taxId: string | null;
    industry: string | null;
    website: string | null;
    primaryContact: {
      name: string;
      email: string | null;
      phone: string | null;
    } | null;
  };
  campaign: {
    name: string;
    startDate: string | null;
    endDate: string | null;
    currency: string | null;
    totalContractValue: number | null;
  };
  owner: { id: string; name: string } | null;
  existingClient: { id: string; companyName: string; accountOwnerUserId: string | null } | null;
  existingCampaign: { id: string; campaignName: string; clientId: string } | null;
  warnings: string[];
};
