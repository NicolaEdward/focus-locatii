import { isSellerCapableRole } from "@/lib/sales-roles";

const SYSTEM_SELLER_NAMES = new Set([
  "admin",
  "administrator",
  "administrator focus media",
  "nealocat",
  "super admin",
  "super administrator"
]);

export type SellerAttribution = {
  salesperson?: string | null;
  sellerUser?: {
    name?: string | null;
    role?: string | null;
    active?: boolean | null;
  } | null;
};

export function reportableSellerName(attribution: SellerAttribution) {
  const user = attribution.sellerUser;
  if (user && (user.active === false || !isSellerCapableRole(user.role))) return null;

  const name = cleanSellerName(user?.name || attribution.salesperson);
  if (!name || SYSTEM_SELLER_NAMES.has(normalizeSellerName(name))) return null;
  return name;
}

export function reportableLooseSellerName(value: string | null | undefined, excludedNames: ReadonlySet<string> = new Set()) {
  const name = cleanSellerName(value);
  if (!name) return null;
  const normalized = normalizeSellerName(name);
  if (SYSTEM_SELLER_NAMES.has(normalized) || excludedNames.has(normalized)) return null;
  return name;
}

export function hasSellerReportActivity(row: {
  activeLeads: number;
  receivedRequests: number;
  reservationsCreated: number;
  activeHolds: number;
  expiredHolds: number;
  confirmedCampaigns: number;
  soldValue: number;
  pipelineValue: number;
  overdueFollowUps: number;
  conversionRate: number | null;
  latestActivityAt: string | null;
}) {
  return Boolean(
    row.activeLeads ||
    row.receivedRequests ||
    row.reservationsCreated ||
    row.activeHolds ||
    row.expiredHolds ||
    row.confirmedCampaigns ||
    row.soldValue ||
    row.pipelineValue ||
    row.overdueFollowUps ||
    row.conversionRate != null ||
    row.latestActivityAt
  );
}

export function normalizeSellerName(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function cleanSellerName(value: string | null | undefined) {
  return String(value || "").trim() || null;
}
