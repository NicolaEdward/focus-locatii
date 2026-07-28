const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const XLSX = require("xlsx");

const PORT = Number(process.env.SMOKE_PORT || 3011);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const NEXT_BIN = require.resolve("next/dist/bin/next");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try {
      const response = await fetch(`${BASE_URL}/api/health/db`);
      if (response.ok) return;
    } catch {
      // Keep waiting until Next is ready.
    }
    await wait(500);
  }
  throw new Error("Server did not become ready within 30s");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) continue;

    const contents = fs.readFileSync(filePath, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

async function cleanupSmokeArtifacts(prisma) {
  const smokeClients = await prisma.clientAccount.findMany({
    where: {
      OR: [
        { companyName: { contains: "Smoke" } },
        { generalEmail: { contains: "smoke" } },
        { normalizedName: { contains: "smoke" } }
      ]
    },
    select: { id: true }
  });
  const smokeClientIds = smokeClients.map((client) => client.id);
  const smokeCampaigns = await prisma.campaign.findMany({
    where: {
      OR: [
        { clientId: { in: smokeClientIds } },
        { campaignName: { contains: "Smoke" } },
        { campaignCode: { contains: "SMOKE" } },
        { notes: { contains: "Smoke" } }
      ]
    },
    select: { id: true }
  });
  const smokeCampaignIds = smokeCampaigns.map((campaign) => campaign.id);

  const smokeReservations = await prisma.reservation.findMany({
    where: {
      OR: [
        { clientId: { in: smokeClientIds } },
        { campaignId: { in: smokeCampaignIds } },
        { clientName: { contains: "Smoke" } },
        { clientCompany: { contains: "Smoke" } },
        { campaignName: { contains: "Smoke" } },
        { contractCompany: { contains: "Smoke" } },
        { contractNumber: { contains: "SMOKE" } },
        { notes: { contains: "Smoke" } },
        { productionNotes: { contains: "Smoke" } }
      ]
    },
    select: { id: true }
  });
  const smokeReservationIds = smokeReservations.map((reservation) => reservation.id);
  const smokeSuppliers = await prisma.supplier.findMany({
    where: {
      OR: [
        { supplierName: { contains: "Smoke" } },
        { normalizedName: { contains: "smoke" } },
        { generalEmail: { contains: "smoke" } }
      ]
    },
    select: { id: true }
  });
  const smokeSupplierIds = smokeSuppliers.map((supplier) => supplier.id);

  const smokeBillingItems = await prisma.billingItem.findMany({
    where: {
      OR: [
        { clientId: { in: smokeClientIds } },
        { reservationId: { in: smokeReservationIds } },
        { invoiceNumber: { contains: "SMOKE" } },
        { notes: { contains: "Smoke" } }
      ]
    },
    select: { id: true }
  });
  const smokeBillingItemIds = smokeBillingItems.map((item) => item.id);

  const smokeReceivables = await prisma.financialReceivable.findMany({
    where: {
      OR: [
        { clientId: { in: smokeClientIds } },
        { campaignId: { in: smokeCampaignIds } },
        { billingItemId: { in: smokeBillingItemIds } },
        { clientName: { contains: "Smoke" } },
        { invoiceNumber: { contains: "SMOKE" } },
        { campaignDetails: { contains: "Smoke" } }
      ]
    },
    select: { id: true, uploadId: true }
  });
  const smokeReceivableIds = smokeReceivables.map((item) => item.id);
  const smokePayables = await prisma.financialPayable.findMany({
    where: {
      OR: [
        { supplierId: { in: smokeSupplierIds } },
        { supplierName: { contains: "Smoke" } },
        { invoiceNumber: { contains: "SMOKE" } },
        { documentDescription: { contains: "Smoke" } }
      ]
    },
    select: { id: true, uploadId: true }
  });
  const smokePayableIds = smokePayables.map((item) => item.id);
  const smokeFinancialUploadIds = [
    ...new Set([
      ...smokeReceivables.map((item) => item.uploadId),
      ...smokePayables.map((item) => item.uploadId)
    ].filter(Boolean))
  ];

  const smokeLeads = await prisma.crmLead.findMany({
    where: {
      OR: [
        { clientId: { in: smokeClientIds } },
        { companyName: { contains: "Smoke" } },
        { notes: { contains: "Smoke" } }
      ]
    },
    select: { id: true }
  });
  const smokeLeadIds = smokeLeads.map((lead) => lead.id);

  await prisma.crmActivity.deleteMany({ where: { leadId: { in: smokeLeadIds } } });
  await prisma.crmContact.deleteMany({ where: { leadId: { in: smokeLeadIds } } });
  await prisma.crmLead.deleteMany({ where: { id: { in: smokeLeadIds } } });
  await prisma.clientDocument.deleteMany({
    where: {
      OR: [
        { clientId: { in: smokeClientIds } },
        { campaignId: { in: smokeCampaignIds } },
        { reservationId: { in: smokeReservationIds } },
        { billingItemId: { in: smokeBillingItemIds } },
        { financialReceivableId: { in: smokeReceivableIds } },
        { supplierId: { in: smokeSupplierIds } },
        { financialPayableId: { in: smokePayableIds } },
        { fileName: { contains: "Smoke" } },
        { notes: { contains: "Smoke" } }
      ]
    }
  });
  await prisma.financialReceivable.deleteMany({ where: { id: { in: smokeReceivableIds } } });
  await prisma.financialPayable.deleteMany({ where: { id: { in: smokePayableIds } } });
  if (smokeFinancialUploadIds.length) {
    const remainingFinancialRows = await prisma.financialPayable.count({ where: { uploadId: { in: smokeFinancialUploadIds } } })
      + await prisma.financialReceivable.count({ where: { uploadId: { in: smokeFinancialUploadIds } } });
    if (remainingFinancialRows === 0) {
      await prisma.financialReportCompanySnapshot.deleteMany({ where: { uploadId: { in: smokeFinancialUploadIds } } });
      await prisma.financialImportIssue.deleteMany({ where: { uploadId: { in: smokeFinancialUploadIds } } });
      await prisma.financialReportUpload.deleteMany({ where: { id: { in: smokeFinancialUploadIds } } });
    }
  }
  await prisma.billingItem.deleteMany({ where: { id: { in: smokeBillingItemIds } } });
  await prisma.rentalPriceSegment.deleteMany({ where: { rentalId: { in: smokeReservationIds } } });
  await prisma.rentalChangeLog.deleteMany({ where: { rentalId: { in: smokeReservationIds } } });
  await prisma.reservation.deleteMany({ where: { id: { in: smokeReservationIds } } });
  await prisma.campaign.deleteMany({ where: { id: { in: smokeCampaignIds } } });
  await prisma.clientContact.deleteMany({ where: { clientId: { in: smokeClientIds } } });
  await prisma.clientAccount.deleteMany({ where: { id: { in: smokeClientIds } } });
  await prisma.supplierContact.deleteMany({ where: { supplierId: { in: smokeSupplierIds } } });
  await prisma.supplier.deleteMany({ where: { id: { in: smokeSupplierIds } } });
  await prisma.offerRequest.deleteMany({
    where: {
      OR: [
        { clientName: { contains: "Smoke" } },
        { company: { contains: "Smoke" } },
        { email: { contains: "smoke" } },
        { message: { contains: "Smoke" } }
      ]
    }
  });
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { contains: "smoke-" } },
        { email: { contains: "visual-coo-" } },
        { name: { contains: "Smoke" } },
        { name: { contains: "Visual COO" } }
      ]
    }
  });
}

async function loginAdmin() {
  assert(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD, "Admin credentials are missing for smoke test");

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD
    })
  });
  assert(response.ok, "Admin login API failed");
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, "Admin login did not set a session cookie");
  return cookie;
}

async function main() {
  loadLocalEnv();
  const prisma = new PrismaClient();
  const server = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    await cleanupSmokeArtifacts(prisma);
    await waitForServer();
    const adminCookie = await loginAdmin();

    const agentEmail = `smoke-agent-${Date.now()}@focusmedia.test`;
    const agentPassword = `Smoke-${Date.now()}-Secure!`;
    const createAgentResponse = await fetch(`${BASE_URL}/api/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ name: "Smoke Sales Agent", email: agentEmail, password: agentPassword, role: "SALES_AGENT" })
    });
    assert(createAgentResponse.ok, "Admin could not create a sales agent");
    const createdAgent = (await createAgentResponse.json()).user;
    const agentLoginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: agentEmail, password: agentPassword })
    });
    assert(agentLoginResponse.ok, "Sales agent login failed");
    const agentCookie = agentLoginResponse.headers.get("set-cookie")?.split(";")[0];
    assert(agentCookie, "Sales agent login did not set a cookie");
    assert((await fetch(`${BASE_URL}/api/locations?scope=admin`, { headers: { cookie: agentCookie } })).ok, "Sales agent cannot view inventory");
    assert((await fetch(`${BASE_URL}/api/admin/users`, { headers: { cookie: agentCookie } })).status === 403, "Sales agent can access user management");
    assert((await fetch(`${BASE_URL}/api/admin/sales-report/excel`, { headers: { cookie: agentCookie } })).status === 403, "Sales agent can access global financial report");
    assert((await fetch(`${BASE_URL}/api/locations`, { method: "POST", headers: { "content-type": "application/json", cookie: agentCookie }, body: JSON.stringify({}) })).status === 403, "Sales agent can modify inventory");
    const deactivateAgentResponse = await fetch(`${BASE_URL}/api/admin/users/${createdAgent.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ active: false })
    });
    assert(deactivateAgentResponse.ok, "Temporary sales agent could not be deactivated");
    assert((await fetch(`${BASE_URL}/api/locations?scope=admin`, { headers: { cookie: agentCookie } })).status === 401, "Deactivated session remains valid");
    await prisma.user.delete({ where: { id: createdAgent.id } });

    const cooEmail = `smoke-coo-${Date.now()}@focusmedia.test`;
    const cooPassword = `Smoke-${Date.now()}-COO!`;
    const createCooResponse = await fetch(`${BASE_URL}/api/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ name: "Smoke COO", email: cooEmail, password: cooPassword, role: "COO" })
    });
    assert(createCooResponse.ok, "Admin could not create a COO user");
    const createdCoo = (await createCooResponse.json()).user;
    const cooLoginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: cooEmail, password: cooPassword })
    });
    assert(cooLoginResponse.ok, "COO login failed");
    const cooCookie = cooLoginResponse.headers.get("set-cookie")?.split(";")[0];
    assert(cooCookie, "COO login did not set a cookie");
    assert((await fetch(`${BASE_URL}/api/admin/users`, { headers: { cookie: cooCookie } })).ok, "COO cannot access user management");
    assert(
      (await fetch(`${BASE_URL}/api/admin/users`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cooCookie },
        body: JSON.stringify({ name: "Blocked Super Admin", email: `blocked-${Date.now()}@focusmedia.test`, password: "Blocked-Super-Admin-123!", role: "SUPER_ADMIN" })
      })).status === 400,
      "COO can create a SUPER_ADMIN"
    );

    const health = await fetch(`${BASE_URL}/api/health/db`).then((response) => response.json());
    assert(health.ok === true || health.status === "ok", "Database health endpoint is not OK");

    const locationsPayload = await fetch(`${BASE_URL}/api/locations`).then((response) => response.json());
    const locations = Array.isArray(locationsPayload) ? locationsPayload : locationsPayload.locations || [];
    assert(locations.length > 0, `Expected public locations, got ${locations.length}`);
    assert(locations.every((location) => location.latDisplay != null && location.lngDisplay != null), "Some locations have missing display GPS");
    assert(
      locations.every((location) => !location.showPricePublic && !location.rateCard && !location.rateCardValue),
      "Public locations API exposes hidden rate card values"
    );
    assert(locations.every((location) => !location.internalNotes && !location.photoOriginalUrl), "Public locations API exposes internal fields");
    assert(
      locations.every((location) => location.reservations == null || (Array.isArray(location.reservations) && location.reservations.length === 0)),
      "Public API exposes reservation details"
    );
    assert(locations.every((location) => location.availabilityText), "Some locations have missing availability text");
    assert(locations.every((location) => location.publicStatus && location.availabilityLabel), "Some locations have missing public availability labels");
    const validPublicStatuses = new Set(["AVAILABLE", "AVAILABLE_FROM", "BOOKED", "RESERVED"]);
    assert(locations.every((location) => validPublicStatuses.has(location.status)), "Unexpected location status found");

    const shortlistIds = locations.slice(0, 3).map((location) => location.id);
    const excelResponse = await fetch(`${BASE_URL}/api/shortlist/excel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: shortlistIds })
    });
    assert(excelResponse.ok, "Shortlist Excel export endpoint failed");
    const excelBuffer = Buffer.from(await excelResponse.arrayBuffer());
    const workbook = XLSX.read(excelBuffer, { type: "buffer" });
    assert(workbook.SheetNames.length > 0, "Excel export has no category sheets");
    const expectedHeaders = [
      "Nr",
      "City",
      "County",
      "Address",
      "Type",
      "GPS",
      "Photo Link",
      "Size",
      "SQM",
      "Illum",
      "Rate Card",
      "Installation & Removal",
      "Availability"
    ];
    let exportedRowCount = 0;
    for (const sheetName of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
      assert(String(rows[0]?.[0] || "").startsWith("Loca"), `Excel sheet ${sheetName} is missing title row`);
      assert(
        expectedHeaders.every((header, index) => rows[1]?.[index] === header),
        `Excel sheet ${sheetName} has unexpected headers`
      );
      exportedRowCount += Math.max(0, rows.length - 2);
    }
    assert(exportedRowCount === shortlistIds.length, "Excel export has unexpected row count");

    const page = await fetch(`${BASE_URL}/locatii`).then((response) => response.text());
    assert(page.includes("Focus Media") || page.includes("Locatii"), "Public locations page did not render expected content");
    assert(!page.includes("Disponibil cu data") && !page.includes("Disponibile cu data"), "Public page still shows available-from label");
    assert(page.includes("Disponibil"), "Public page does not show available inventory after legacy reset");
    assert(/selec(?:t|\u021b)ie client/i.test(page), "Public page does not show the location selection call-to-action");

    const admin = await fetch(`${BASE_URL}/admin/login`).then((response) => response.text());
    assert(admin.includes("email") || admin.includes("parola") || admin.includes("password"), "Admin login page did not render expected content");

    const blockedAdminLocations = await fetch(`${BASE_URL}/api/locations?scope=admin`);
    assert(blockedAdminLocations.status === 401, "Admin locations endpoint is accessible without login");
    const blockedReservations = await fetch(`${BASE_URL}/api/reservations`);
    assert(blockedReservations.status === 401, "Reservations endpoint is accessible without login");
    const blockedRequests = await fetch(`${BASE_URL}/api/offer-requests`);
    assert(blockedRequests.status === 401, "Offer requests admin endpoint is accessible without login");

    const offerResponse = await fetch(`${BASE_URL}/api/offer-requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Smoke Test",
        email: `smoke-${Date.now()}@example.com`,
        selectedLocationIds: shortlistIds,
        message: "Automated smoke request"
      })
    });
    assert(offerResponse.ok, "Public offer request endpoint failed");
    const offerPayload = await offerResponse.json();
    assert(offerPayload.request?.id, "Offer request response is missing id");

    const offerProgressResponse = await fetch(`${BASE_URL}/api/offer-requests/${offerPayload.request.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ status: "CONTACTED", crmStatus: "NEGOTIATION", salesperson: "Smoke Seller", estimatedValue: 1234, nextFollowUpAt: "2036-01-05", notes: "Smoke CRM note" })
    });
    assert(offerProgressResponse.ok, "Offer request progress update failed");
    const offerProgressPayload = await offerProgressResponse.json();
    assert(offerProgressPayload.request?.salesperson === "Smoke Seller", "Offer request salesperson was not saved");
    assert(offerProgressPayload.request?.crmStatus === "NEGOTIATION", "Offer request CRM status was not saved");
    assert(offerProgressPayload.request?.estimatedValue === 1234, "Offer request CRM value was not saved");

    const offerDeleteResponse = await fetch(`${BASE_URL}/api/offer-requests/${offerPayload.request.id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie }
    });
    assert(offerDeleteResponse.ok, "Offer request soft delete failed");
    const offerDeletePayload = await offerDeleteResponse.json();
    assert(offerDeletePayload.request?.status === "ARCHIVED", "Offer request soft delete did not archive request");
    assert(offerDeletePayload.request?.deletedAt, "Offer request soft delete did not set deletedAt");
    await prisma.offerRequest.delete({ where: { id: offerPayload.request.id } }).catch(() => null);

    assert(locations.length >= 2, "Expected at least two locations for grouped reservation smoke test");
    const clientResponse = await fetch(`${BASE_URL}/api/admin/clients`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        companyName: "Smoke Client OOH",
        clientType: "direct_client",
        generalEmail: "smoke-client@focusmedia.test",
        accountOwnerUserId: createdCoo.id
      })
    });
    assert(clientResponse.ok, "Admin could not create a real client for rental");
    const smokeClient = (await clientResponse.json()).client;
    assert(smokeClient.companyName === "Smoke Client OOH", "Created client response returned a different company name");
    assert(smokeClient.status === "active", "Created client is not active");
    const clientWorkspaceResponse = await fetch(`${BASE_URL}/api/admin/client-campaigns?q=${encodeURIComponent(smokeClient.companyName)}`, {
      headers: { cookie: adminCookie }
    });
    assert(clientWorkspaceResponse.ok, "Client workspace did not reload after client create");
    const clientWorkspacePayload = await clientWorkspaceResponse.json();
    assert(
      clientWorkspacePayload.data?.clients?.some((client) => client.clientId === smokeClient.id),
      "Created client disappeared from Clienti workspace after refresh"
    );
    const simpleClientsResponse = await fetch(`${BASE_URL}/api/admin/clients?q=${encodeURIComponent(smokeClient.companyName)}`, {
      headers: { cookie: adminCookie }
    });
    assert(simpleClientsResponse.ok, "Simple clients API did not reload after client create");
    const simpleClientsPayload = await simpleClientsResponse.json();
    assert(
      simpleClientsPayload.clients?.some((client) => client.id === smokeClient.id),
      "Created client disappeared from clients dropdown/search API after refresh"
    );

    const extraClientIds = [];
    for (const index of [1, 2, 3, 4, 5]) {
      const extraClientName = `Smoke Refresh Client ${index}`;
      const extraClientResponse = await fetch(`${BASE_URL}/api/admin/clients`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({
          companyName: extraClientName,
          clientType: "direct_client",
          generalEmail: `smoke-refresh-${index}@focusmedia.test`,
          status: "active",
          accountOwnerUserId: createdCoo.id
        })
      });
      assert(extraClientResponse.ok, `Admin could not create refresh regression client ${index}`);
      const extraClient = (await extraClientResponse.json()).client;
      assert(extraClient.companyName === extraClientName, `Refresh regression client ${index} returned the wrong name`);
      assert(extraClient.status === "active", `Refresh regression client ${index} is not active`);
      extraClientIds.push(extraClient.id);
    }
    const refreshedClientsResponse = await fetch(`${BASE_URL}/api/admin/client-campaigns`, {
      headers: { cookie: adminCookie }
    });
    assert(refreshedClientsResponse.ok, "Client workspace full refresh failed after multiple creates");
    const refreshedClientsPayload = await refreshedClientsResponse.json();
    assert(
      extraClientIds.every((id) => refreshedClientsPayload.data?.clients?.some((client) => client.clientId === id)),
      "One or more newly created clients disappeared from Clienti workspace after full refresh"
    );
    const refreshedSimpleClientsResponse = await fetch(`${BASE_URL}/api/admin/clients`, {
      headers: { cookie: adminCookie }
    });
    assert(refreshedSimpleClientsResponse.ok, "Simple clients full refresh failed after multiple creates");
    const refreshedSimpleClientsPayload = await refreshedSimpleClientsResponse.json();
    assert(
      extraClientIds.every((id) => refreshedSimpleClientsPayload.clients?.some((client) => client.id === id)),
      "One or more newly created clients disappeared from clients dropdown API after full refresh"
    );
    const campaignResponse = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        clientId: smokeClient.id,
        campaignName: "Smoke Campaign OOH",
        campaignCode: "SMOKE-CAMPAIGN",
        status: "active",
        companyEntity: "Focus Media",
        startDate: "2036-01-10",
        endDate: "2036-01-20",
        currency: "EUR",
        totalContractValue: 2000,
        paymentTermType: "30_days",
        billingRule: "manual_per_contract"
      })
    });
    assert(campaignResponse.ok, "Admin could not create a real campaign for rental");
    const smokeCampaign = (await campaignResponse.json()).campaign;
    assert(
      smokeCampaign.startDate === null && smokeCampaign.endDate === null && smokeCampaign.totalContractValue === null,
      "Campaign creation persisted manual period/value instead of waiting for BOOKED rentals"
    );
    const campaignEditResponse = await fetch(`${BASE_URL}/api/admin/campaigns/${smokeCampaign.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        campaignName: "Smoke Campaign OOH Updated",
        companyEntity: "Excellence Media",
        notes: "Smoke campaign edited"
      })
    });
    const campaignEditPayload = await campaignEditResponse.json().catch(() => null);
    assert(campaignEditResponse.ok, `Campaign edit failed: ${campaignEditPayload?.error || campaignEditResponse.status}`);
    assert(campaignEditPayload.campaign?.campaignName === "Smoke Campaign OOH Updated", "Campaign edit did not persist name");
    assert(campaignEditPayload.campaign?.companyEntity === "Excellence Media", "Campaign edit did not normalize company entity");
    smokeCampaign.campaignName = campaignEditPayload.campaign.campaignName;
    smokeCampaign.companyEntity = campaignEditPayload.campaign.companyEntity;

    const invalidCampaignCompanyResponse = await fetch(`${BASE_URL}/api/admin/campaigns/${smokeCampaign.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ companyEntity: "Smoke Invalid Company SRL" })
    });
    assert(invalidCampaignCompanyResponse.status === 400, "Campaign accepted manual invalid contracting company");

    const archiveCampaignResponse = await fetch(`${BASE_URL}/api/admin/campaigns`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        clientId: smokeClient.id,
        campaignName: "Smoke Campaign Archive",
        status: "draft",
        companyEntity: "Focus BG / Focus Media LLC EOOD",
        currency: "RON"
      })
    });
    assert(archiveCampaignResponse.ok, "Admin could not create campaign for archive test");
    const archiveCampaign = (await archiveCampaignResponse.json()).campaign;
    const archiveResponse = await fetch(`${BASE_URL}/api/admin/campaigns/${archiveCampaign.id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie }
    });
    const archivePayload = await archiveResponse.json().catch(() => null);
    assert(archiveResponse.ok, `Campaign archive failed: ${archivePayload?.error || archiveResponse.status}`);
    assert(archivePayload.campaign?.status === "archived", "Campaign archive did not mark status archived");

    const invalidBookedTextClientResponse = await fetch(`${BASE_URL}/api/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        locationIds: [locations[0].id],
        status: "BOOKED",
        clientName: "Smoke Text Client Should Fail",
        campaignName: "Smoke Text Campaign Should Fail",
        monthlyRentTotal: 1000,
        periodStart: "2036-02-01",
        periodEnd: "2036-02-28"
      })
    });
    assert(invalidBookedTextClientResponse.status === 400, "Booked rental accepted manual client/campaign text");

    const testReservationBody = {
      locationIds: [locations[0].id, locations[1].id],
      locationId: locations[0].id,
      status: "RESERVED",
      clientName: "Smoke Test",
      contractCompany: "Focus Media",
      campaignName: "Smoke Conflict",
      contractNumber: "SMOKE-2036",
      monthlyRentTotal: 2000,
      periodStart: "2036-01-10",
      periodEnd: "2036-01-20",
      installationDate: "2036-01-08",
      productionNotes: "Smoke grouped install"
    };
    const reservationResponse = await fetch(`${BASE_URL}/api/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify(testReservationBody)
    });
    assert(reservationResponse.ok, "Admin reservation creation failed");
    const reservationPayload = await reservationResponse.json();
    assert(reservationPayload.reservation?.id, "Reservation response is missing id");
    assert(Array.isArray(reservationPayload.reservations), "Grouped reservation response is missing reservations list");
    assert(reservationPayload.reservations.length === 2, "Grouped reservation did not create two rows");
    assert(reservationPayload.reservations.every((reservation) => reservation.contractGroupId), "Grouped reservations are missing group id");
    assert(
      new Set(reservationPayload.reservations.map((reservation) => reservation.contractGroupId)).size === 1,
      "Grouped reservations do not share the same group id"
    );
    assert(
      reservationPayload.reservations.every((reservation) => reservation.amount === 1000 && reservation.monthlyRentShare === 1000),
      "Grouped reservation rent was not split correctly"
    );
    assert(
      reservationPayload.reservations.every((reservation) => reservation.holdExpiresAt && !reservation.bookedAt),
      "New holds do not have the five-day expiration metadata"
    );

    const cooCommandResponse = await fetch(`${BASE_URL}/api/admin/command-center`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cooCookie },
      body: JSON.stringify({ reservationId: reservationPayload.reservation.id, action: "extendHold", days: 7 })
    });
    assert(cooCommandResponse.ok, "COO command center hold extension failed");

    const groupedStatusResponse = await fetch(`${BASE_URL}/api/reservations/${reservationPayload.reservation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ status: "BOOKED", applyToGroup: true })
    });
    assert(groupedStatusResponse.status === 400, "Hold converted to BOOKED without real client/campaign");

    const convertedReservations = [];
    for (const reservation of reservationPayload.reservations) {
      const convertResponse = await fetch(`${BASE_URL}/api/reservations/${reservation.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({
          status: "BOOKED",
          clientId: smokeClient.id,
          campaignId: smokeCampaign.id,
          amount: 1000,
          monthlyRentTotal: 2000,
          monthlyRentShare: 1000,
          currency: "EUR",
          periodStart: "2036-01-10",
          periodEnd: "2036-01-20"
        })
      });
      assert(convertResponse.ok, "Hold conversion with real client/campaign failed");
      convertedReservations.push((await convertResponse.json()).reservation);
    }
    assert(convertedReservations.length === 2, "Hold conversion did not process every location");
    assert(
      convertedReservations.every((reservation) => reservation.status === "BOOKED" && reservation.clientId === smokeClient.id && reservation.campaignId === smokeCampaign.id),
      "Converted rentals are not linked to client and campaign"
    );
    assert(
      convertedReservations.every((reservation) => reservation.bookedAt && !reservation.holdExpiresAt),
      "Closing a converted rental did not set bookedAt and clear hold expiry"
    );
    assert(
      convertedReservations.every((reservation) => Array.isArray(reservation.priceSegments) && reservation.priceSegments.length >= 1),
      "Converted rentals did not create initial price segments"
    );
    assert(
      convertedReservations.every((reservation) => reservation.neutralizationDate),
      "Converted rentals did not schedule neutralization"
    );
    const derivedCampaignResponse = await fetch(`${BASE_URL}/api/admin/campaigns/${smokeCampaign.id}`, {
      headers: { cookie: adminCookie }
    });
    const derivedCampaignPayload = await derivedCampaignResponse.json().catch(() => null);
    assert(derivedCampaignResponse.ok, "Campaign derived commercial summary could not be loaded");
    assert(
      derivedCampaignPayload.campaign?.startDate?.startsWith("2036-01-10") &&
      derivedCampaignPayload.campaign?.endDate?.startsWith("2036-01-20"),
      "Campaign period was not derived from the first and last BOOKED dates"
    );
    assert(
      derivedCampaignPayload.campaign?.totalContractValue === 709.68 &&
      derivedCampaignPayload.campaign?.totalsByCurrency?.EUR === 709.68,
      "Campaign value was not calculated from monthly rents using pro-rata"
    );

    const directNoDecorationResponse = await fetch(`${BASE_URL}/api/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        locationIds: [locations[2].id],
        locationId: locations[2].id,
        status: "BOOKED",
        clientId: smokeClient.id,
        campaignId: smokeCampaign.id,
        monthlyRentTotal: 1500,
        periodStart: "2036-03-01",
        periodEnd: "2036-03-31",
        currency: "EUR",
        productionNotes: "Smoke rental without initial decoration"
      })
    });
    const directNoDecorationPayload = await directNoDecorationResponse.json().catch(() => null);
    assert(directNoDecorationResponse.ok, `Direct rental without decoration failed: ${directNoDecorationPayload?.error || directNoDecorationResponse.status}`);
    const directNoDecoration = directNoDecorationPayload.reservation;
    assert(!directNoDecoration.installationDate, "Rental without decoration created installation task date");
    assert(directNoDecoration.neutralizationDate?.startsWith("2036-03-31"), "Rental without decoration did not schedule neutralization at period end");

    const bookedEditTarget = convertedReservations[0];
    assert(bookedEditTarget?.clientId && bookedEditTarget?.campaignId, `Converted target is missing client/campaign: ${JSON.stringify(bookedEditTarget)}`);
    const bookedEditResponse = await fetch(`${BASE_URL}/api/reservations/${bookedEditTarget.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        clientName: "Smoke Test Edited",
        contractCompany: "Smoke Contract Updated SRL",
        campaignName: "Smoke Conflict Edited",
        amount: 1100,
        monthlyRentTotal: 2200,
        monthlyRentShare: 1100,
        periodStart: "2036-01-10",
        periodEnd: "2036-01-20",
        notes: "Smoke edit on already booked reservation"
      })
    });
    const bookedEditPayload = await bookedEditResponse.json().catch(() => null);
    assert(bookedEditResponse.ok, `Booked reservation edit failed: ${bookedEditResponse.status} ${bookedEditPayload?.error || ""}`);
    assert(bookedEditPayload.reservation?.clientName === "Smoke Client OOH", "Booked reservation accepted manual client text instead of DB client");
    assert(bookedEditPayload.reservation?.amount === 1100, "Booked reservation edit did not save corrected rent");
    assert(bookedEditPayload.reservation?.contractCompany === "Excellence Media", "Booked reservation accepted manual contract company instead of campaign entity");
    assert(bookedEditPayload.reservation?.neutralizationDate?.startsWith("2036-01-20"), "Booked reservation edit did not keep neutralization synced");

    const supplierResponse = await fetch(`${BASE_URL}/api/admin/suppliers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        supplierName: "Smoke Supplier OOH",
        generalEmail: "smoke-supplier@focusmedia.test",
        notes: "Smoke supplier for manual financial invoice"
      })
    });
    assert(supplierResponse.ok, "Admin could not create supplier for manual payable");
    const smokeSupplier = (await supplierResponse.json()).supplier;

    const manualReceivableResponse = await fetch(`${BASE_URL}/api/admin/financial/manual`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        kind: "receivable",
        companyName: "Focus Media",
        clientId: smokeClient.id,
        campaignId: smokeCampaign.id,
        invoiceNumber: "SMOKE FCSM-1299",
        invoiceDate: "2036-01-21",
        dueDate: "2036-02-20",
        amount: 1200,
        paidOrCollected: 200,
        currency: "RON",
        note: "Smoke manual receivable"
      })
    });
    assert(manualReceivableResponse.ok, "Manual client invoice creation failed");

    const duplicateReceivableResponse = await fetch(`${BASE_URL}/api/admin/financial/manual`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        kind: "receivable",
        companyName: "Focus Media",
        clientId: smokeClient.id,
        campaignId: smokeCampaign.id,
        invoiceNumber: "factura SMOKE-FCSM 1299",
        invoiceDate: "2036-01-21",
        dueDate: "2036-02-20",
        amount: 1200,
        paidOrCollected: 0,
        currency: "RON",
        note: "Smoke duplicate manual receivable"
      })
    });
    assert(duplicateReceivableResponse.status === 409, "Manual client invoice duplicate was not detected");

    const manualPayableResponse = await fetch(`${BASE_URL}/api/admin/financial/manual`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        kind: "payable",
        companyName: "Focus Media",
        supplierId: smokeSupplier.id,
        invoiceNumber: "SMOKE-SUP-001",
        invoiceDate: "2036-01-22",
        dueDate: "2036-02-10",
        amount: 500,
        paidOrCollected: 100,
        currency: "RON",
        note: "Smoke manual payable"
      })
    });
    assert(manualPayableResponse.ok, "Manual supplier invoice creation failed");

    const generatedBillingItems = await prisma.billingItem.count({
      where: {
        OR: [
          { clientId: smokeClient.id },
          { reservationId: { in: [...convertedReservations.map((reservation) => reservation.id), directNoDecoration.id] } },
          { invoiceNumber: { contains: "SMOKE" } }
        ],
        status: { not: "archived" }
      }
    });
    assert(generatedBillingItems === 0, "Rental/manual invoices generated active BillingItems");

    const operationResponse = await fetch(`${BASE_URL}/api/reservations/${bookedEditTarget.id}/operations`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ kind: "decoration", status: "DONE" })
    });
    const operationText = await operationResponse.text();
    assert(operationResponse.ok, `Reservation operation status update failed: ${operationResponse.status} ${operationText}`);
    const operationPayload = JSON.parse(operationText);
    assert(
      String(operationPayload.reservation?.productionNotes || "").includes("decorationStatus"),
      "Reservation operation status metadata was not saved"
    );

    const redecorationTarget = convertedReservations[1];
    const redecorationResponse = await fetch(`${BASE_URL}/api/reservations/${redecorationTarget.id}/operations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        kind: "decoration",
        taskType: "redecoration",
        requestedDate: "2036-01-15",
        cost: 300,
        currency: "RON",
        costOwner: "client",
        note: "Smoke redecoration only on second location"
      })
    });
    const redecorationPayload = await redecorationResponse.json().catch(() => null);
    assert(redecorationResponse.ok, `Redecoration task creation failed: ${redecorationPayload?.error || redecorationResponse.status}`);
    assert(
      String(redecorationPayload.reservation?.productionNotes || "").includes("redecoration"),
      "Redecoration metadata was not saved on selected location"
    );
    const firstConvertedAfterRedecoration = await prisma.reservation.findUnique({ where: { id: convertedReservations[0].id }, select: { productionNotes: true } });
    assert(!String(firstConvertedAfterRedecoration?.productionNotes || "").includes("Smoke redecoration only on second location"), "Redecoration leaked to another campaign location");

    const conflictResponse = await fetch(`${BASE_URL}/api/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ ...testReservationBody, clientName: "Smoke Test Conflict", periodStart: "2036-01-15" })
    });
    assert(conflictResponse.status === 400, "Overlapping reservation was not rejected");

    const invalidReservationDateResponse = await fetch(`${BASE_URL}/api/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ ...testReservationBody, periodStart: "2036-02-31", periodEnd: "2036-03-10" })
    });
    assert(invalidReservationDateResponse.status === 400, "Invalid reservation date was not rejected");

    for (const reservation of reservationPayload.reservations) {
      await fetch(`${BASE_URL}/api/reservations/${reservation.id}`, {
        method: "DELETE",
        headers: { cookie: adminCookie }
      });
    }
    await fetch(`${BASE_URL}/api/reservations/${directNoDecoration.id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie }
    });

    const staleHold = await prisma.reservation.create({
      data: {
        locationId: locations[0].id,
        status: "RESERVED",
        clientName: "Smoke Expired Hold",
        periodStart: new Date("2037-01-01T00:00:00.000Z"),
        periodEnd: new Date("2037-01-02T00:00:00.000Z"),
        holdExpiresAt: new Date("2020-01-01T00:00:00.000Z")
      }
    });
    const expireResponse = await fetch(`${BASE_URL}/api/reservations?locationId=${locations[0].id}`, {
      headers: { cookie: adminCookie }
    });
    assert(expireResponse.ok, "Reservation list failed while expiring stale holds");
    const expirePayload = await expireResponse.json();
    assert(
      expirePayload.reservations.some((reservation) => reservation.id === staleHold.id && reservation.status === "EXPIRED"),
      "Stale hold was not expired automatically"
    );
    await prisma.reservation.delete({ where: { id: staleHold.id } });

    const adminExcelResponse = await fetch(`${BASE_URL}/api/admin/availability/excel`, {
      headers: { cookie: adminCookie }
    });
    assert(adminExcelResponse.ok, "Admin availability Excel export failed");
    const adminWorkbook = XLSX.read(Buffer.from(await adminExcelResponse.arrayBuffer()), { type: "buffer" });
    assert(adminWorkbook.SheetNames.length > 0, "Admin availability export has no sheets");
    const firstAdminRows = XLSX.utils.sheet_to_json(adminWorkbook.Sheets[adminWorkbook.SheetNames[0]], {
      header: 1,
      defval: ""
    });
    assert(
      expectedHeaders.every((header, index) => firstAdminRows[1]?.[index] === header),
      "Admin availability export has unexpected headers"
    );

    const adminFilteredExcelResponse = await fetch(`${BASE_URL}/api/admin/availability/excel?from=2036-01-01&to=2036-02-28`, {
      headers: { cookie: adminCookie }
    });
    assert(adminFilteredExcelResponse.ok, "Admin filtered availability Excel export failed");
    const adminInvalidDateExcelResponse = await fetch(`${BASE_URL}/api/admin/availability/excel?from=2036-02-31&to=2036-03-31`, {
      headers: { cookie: adminCookie }
    });
    assert(adminInvalidDateExcelResponse.status === 400, "Admin availability export accepted an invalid date");

    const salesReportResponse = await fetch(`${BASE_URL}/api/admin/sales-report/excel?from=2036-01-01&to=2036-12-31`, {
      headers: { cookie: adminCookie }
    });
    assert(salesReportResponse.ok, "Admin sales report Excel export failed");
    const salesWorkbook = XLSX.read(Buffer.from(await salesReportResponse.arrayBuffer()), { type: "buffer" });
    assert(salesWorkbook.SheetNames.includes("Situatie vanzari"), "Sales report sheet is missing");
    const salesRows = XLSX.utils.sheet_to_json(salesWorkbook.Sheets["Situatie vanzari"], {
      header: 1,
      defval: ""
    });
    assert(String(salesRows[0]?.[1] || "").includes("LOCATII FOCUS MEDIA"), "Sales report title is missing");
    assert(salesRows[2]?.[8] === "Ratecard/\r\nmonth", "Sales report ratecard header does not match the reference model");
    assert(salesRows[2]?.[9] === "PRET DE VANZARE ", "Sales report sales price header does not match the reference model");
    assert(salesRows[2]?.[10] === "Client", "Sales report client header is missing");
    assert(String(salesRows[3]?.[3] || "").includes("Pod CF Miorita"), "Sales report does not start with Pod CF Miorita");
    assert(String(salesRows[4]?.[3] || "").includes("Pod CF Miorita"), "Sales report second row is not Pod CF Miorita");
    assert(String(salesRows[5]?.[3] || "").includes("Pasaj Baneasa"), "Sales report does not follow the reference order");
    assert(/^A1:K\d+$/.test(salesWorkbook.Sheets["Situatie vanzari"]["!ref"]), "Sales report contains unnecessary formatted columns");
    assert(
      salesRows.some((row) => row[0] === "NUMAR LOCATII VANDUTE -" && row[6] === "SUMA LOCATII VANDUTE"),
      "Sales report sold totals are missing from the main sheet"
    );
    assert(
      salesRows.some((row) => row[0] === "NUMAR LOCATII NEVANDUTE" && row[6] === "SUMA LOCATII NEVANDUTE"),
      "Sales report unsold totals are missing from the main sheet"
    );
    assert(salesWorkbook.SheetNames.includes("Totaluri"), "Sales report totals sheet is missing");
    await prisma.user.delete({ where: { id: createdCoo.id } }).catch(() => null);

    console.log(
      JSON.stringify(
        {
          ok: true,
          checked: [
            "database health",
            "locations API",
            "public page",
            "admin login",
            "role-based API access and session revocation",
            "COO admin permissions",
            "shortlist Excel export",
            "admin auth guards",
            "offer request flow",
            "offer request assignment and soft delete",
            "client create remains visible after filtered and full refresh",
            "campaign edit and archive",
            "contracting company dropdown validation",
            "grouped reservation rent split",
            "COO command center action",
            "neutralization scheduled without decoration",
            "single-location redecoration task",
            "booked reservation correction",
            "manual client invoice and duplicate guard",
            "manual supplier invoice",
            "no BillingItems generated from rentals",
            "reservation operation status",
            "reservation conflict guard",
            "reservation database sync",
            "admin availability export",
            "admin sales report export"
          ],
          locationCount: locations.length,
          withPhotos: locations.filter((location) => location.mainPhotoUrl).length,
          missingPhotos: locations.filter((location) => !location.mainPhotoUrl).length
        },
        null,
        2
      )
    );
  } catch (error) {
    if (output.trim()) console.error(output.trim());
    throw error;
  } finally {
    await cleanupSmokeArtifacts(prisma).catch(() => null);
    await prisma.$disconnect();
    server.kill();
    await wait(500);
    if (!server.killed) server.kill("SIGKILL");
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
