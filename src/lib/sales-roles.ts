export const SELLER_CAPABLE_ROLES = ["SALES_AGENT", "SALES_DIRECTOR", "COO"] as const;

export function isSellerCapableRole(role: string | null | undefined) {
  return SELLER_CAPABLE_ROLES.includes(String(role || "") as (typeof SELLER_CAPABLE_ROLES)[number]);
}

/** Management must choose the accountable seller explicitly, even when seller-capable. */
export function canDefaultSalesOwnerToActor(role: string | null | undefined) {
  return role === "SALES_AGENT" || role === "SALES_DIRECTOR";
}
