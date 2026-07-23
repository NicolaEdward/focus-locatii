const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
const service = read("src", "lib", "client-campaign-workspaces.ts");
const clientsPage = read("src", "app", "admin", "clienti", "page.tsx");
const campaignsPage = read("src", "app", "admin", "campanii", "page.tsx");
const clientsUi = read("src", "components", "admin", "client-campaigns", "ClientsWorkspace.tsx");
const campaignsUi = read("src", "components", "admin", "client-campaigns", "CampaignsWorkspace.tsx");
const clientsRoute = read("src", "app", "api", "admin", "clients", "route.ts");
const campaignsRoute = read("src", "app", "api", "admin", "campaigns", "route.ts");
const campaignDomain = read("src", "lib", "campaigns.ts");

assert(clientsPage.includes("getClientsPage") && clientsPage.includes("ClientsWorkspace"), "Clients route must use the dedicated paginated workspace.");
assert(!clientsPage.includes("getClientCampaignsData") && !clientsPage.includes("ClientCampaignsWorkspace"), "Clients route must not hydrate the combined legacy workspace.");
assert(campaignsPage.includes("getCampaignsPage") && campaignsPage.includes("CampaignsWorkspace"), "Campaigns route must open the dedicated campaigns workspace.");
assert(!campaignsPage.includes("getClientCampaignsData") && !campaignsPage.includes("ClientCampaignsWorkspace"), "Campaigns route must not hydrate the combined legacy workspace.");

assert(service.includes("CLIENT_CAMPAIGN_PAGE_SIZE = 30") && service.includes("MAX_PAGE_SIZE = 50"), "List APIs must have bounded pages.");
assert(service.includes("cursor: { id: input.cursor }, skip: 1") && service.includes("take: limit + 1"), "List APIs must use cursor pagination.");
assert(service.includes("getClientOverview") && service.includes("getCampaignOverview"), "Client and campaign overview contracts must be separate.");
for (const loader of ["getClientContacts", "getClientDocuments", "getClientFinanceSummary", "getCampaignReservations", "getCampaignDocuments", "getCampaignFinanceSummary"]) {
  assert(service.includes(`export async function ${loader}`), `${loader} must be loaded on demand.`);
}
const clientListBlock = between(service, "export async function getClientsPage", "export async function getCampaignsPage");
assert(!clientListBlock.includes("storageUrl"), "Client list must never include document storage data.");
assert(!clientListBlock.includes("billingAddress: true") && !clientListBlock.includes("generalEmail: true"), "Client list must not include sensitive detail fields.");
const campaignListBlock = between(service, "export async function getCampaignsPage", "export async function getClientOverview");
assert(campaignListBlock.includes("activeCampaignBookingWhere(now)"), "Campaign list may load only active BOOKED periods as lifecycle evidence.");
assert(campaignListBlock.includes("select: { status: true, periodStart: true, periodEnd: true }"), "Campaign lifecycle evidence must remain a minimal relation projection.");
assert(!campaignListBlock.includes("clientName: true") && !campaignListBlock.includes("productionNotes: true"), "Campaign list must not hydrate reservation business details.");
assert(campaignListBlock.includes("_count: { select: { reservations: true } }"), "Campaign list may return only a reservation count.");
assert(service.includes("financialDocumentScope(session)"), "Finance document tabs must apply the financial-only access policy.");
assert(service.includes("financialReceivableId: { not: null }"), "Finance document tabs must exclude unrelated document metadata.");

assert(clientsRoute.includes("getClientsPage") && clientsRoute.includes("page.items"), "Clients API must return the canonical paginated list.");
assert(campaignsRoute.includes("getCampaignsPage") && campaignsRoute.includes("page.items"), "Campaigns API must return the canonical paginated list.");
assert(clientsUi.includes("window.setTimeout") && clientsUi.includes("350"), "Client search must be debounced.");
assert(campaignsUi.includes("window.setTimeout") && campaignsUi.includes("350"), "Campaign search must be debounced.");
assert(clientsUi.includes('tab === "overview"') && clientsUi.includes("loadSection(tab)"), "Client tabs must lazy-load details.");
assert(campaignsUi.includes('tab === "overview"') && campaignsUi.includes("loadSection(tab)"), "Campaign tabs must lazy-load details.");
assert(clientsUi.includes("Vizibil doar pentru prevenirea duplicatelor") && clientsUi.includes("overview.canEdit"), "Sales dedup visibility must remain read-only for foreign clients.");
assert(clientsUi.includes("merge/preview") && clientsUi.includes("Confirma merge"), "Client merge must require preview and explicit confirmation.");
assert(service.includes('if (!["COO", "SUPER_ADMIN"].includes(session.role))'), "Merge preview must remain restricted to global managers.");
assert(campaignDomain.includes("Campania trebuie legata de un client activ") && campaignDomain.includes("resolveRequiredSalesOwner"), "Campaign creation must keep client and explicit owner validation.");
assert(campaignDomain.includes("effectiveBlockingReservationWhere") && campaignDomain.includes("Campania are inchirieri/hold-uri active"), "Campaign archive must remain blocked by active occupancy.");
assert(campaignsUi.includes("/api/reservations/${reservation.id}/operations"), "Redecoration mutation must remain available from campaign rental detail.");
assert(clientsUi.includes("/api/admin/clients/finance") && clientsPage.includes("initialPortfolioFinance"), "Legacy sales invoice deep links must open the lazy owned-finance view.");

for (const route of [
  ["clients", "[id]", "contacts", "route.ts"], ["clients", "[id]", "documents", "route.ts"],
  ["clients", "[id]", "campaigns", "route.ts"], ["clients", "[id]", "finance", "route.ts"],
  ["campaigns", "[id]", "reservations", "route.ts"], ["campaigns", "[id]", "documents", "route.ts"],
  ["campaigns", "[id]", "finance", "route.ts"]
]) {
  assert(fs.existsSync(path.join(process.cwd(), "src", "app", "api", "admin", ...route)), `Missing lazy detail API: ${route.join("/")}`);
}

console.log(JSON.stringify({
  ok: true,
  checked: [
    "dedicated client/campaign routes",
    "cursor pagination and capped payloads",
    "lazy detail APIs",
    "ownership-safe dedup visibility",
    "merge preview/audit flow",
    "campaign ownership and archive guards",
    "reservation and finance deep-link parity"
  ]
}, null, 2));

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}
