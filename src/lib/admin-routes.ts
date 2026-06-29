export type AdminRouteParams = Record<string, string | number | boolean | null | undefined>;

export const ADMIN_RESERVATIONS_ANCHOR = "rezervari";
export const ADMIN_LOCATIONS_ANCHOR = "locatii";

export function adminReservationsHref(params: AdminRouteParams = {}) {
  return adminHref("/admin/locatii", params, ADMIN_RESERVATIONS_ANCHOR);
}

export function adminNewReservationHref(params: AdminRouteParams = {}) {
  return adminReservationsHref({ ...params, newReservation: 1 });
}

export function adminReservationHref(reservationId?: string | null) {
  return reservationId ? adminReservationsHref({ reservationId }) : adminReservationsHref();
}

export function adminLocationHref(locationIdOrCode?: string | null) {
  return locationIdOrCode
    ? adminHref("/admin/locatii", { locationId: locationIdOrCode }, ADMIN_LOCATIONS_ANCHOR)
    : adminHref("/admin/locatii", {}, ADMIN_LOCATIONS_ANCHOR);
}

export function adminClientHref(clientId?: string | null) {
  return clientId ? adminHref("/admin/clienti", { clientId }) : "/admin/clienti";
}

export function adminCampaignHref(campaignId?: string | null) {
  return campaignId ? adminHref("/admin/campanii", { campaignId }) : "/admin/campanii";
}

export function adminOperationalHref(params: AdminRouteParams = {}) {
  return adminReservationsHref({ panel: "decorations", ...params });
}

export function adminLocationSelectorHref(params: AdminRouteParams = {}) {
  return adminHref("/admin/selectie-locatii", params);
}

function adminHref(path: string, params: AdminRouteParams = {}, anchor?: string) {
  const suffix = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== false && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value === true ? "1" : String(value))}`)
    .join("&");
  return `${path}${suffix ? `?${suffix}` : ""}${anchor ? `#${anchor}` : ""}`;
}
