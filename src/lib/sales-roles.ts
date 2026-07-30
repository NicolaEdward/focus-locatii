export const SELLER_CAPABLE_ROLES = ["SALES_AGENT", "SALES_DIRECTOR", "COO"] as const;

export function isSellerCapableRole(role: string | null | undefined) {
  return SELLER_CAPABLE_ROLES.includes(String(role || "") as (typeof SELLER_CAPABLE_ROLES)[number]);
}
