import { Prisma, PrismaClient, type UserRole } from "@prisma/client";
import accounts from "../scripts/release/preview-accounts.json";
import { assertSyntheticEnvironment, loadEnvFile } from "../scripts/release/env-utils";
import { hashPassword } from "../src/lib/auth";

loadEnvFile();
const identity = assertSyntheticEnvironment();
const password = process.env.PREVIEW_TEST_PASSWORD || "";
if (!password || password.length < 16) throw new Error("PREVIEW_TEST_PASSWORD trebuie să aibă minimum 16 caractere.");

const prisma = new PrismaClient();
const ids = {
  category: "preview-category-city",
  availableLocation: "preview-location-available",
  bookedLocation: "preview-location-booked",
  holdLocation: "preview-location-hold",
  clientAgent: "preview-client-agent",
  clientDirector: "preview-client-director",
  campaignAgent: "preview-campaign-agent",
  campaignDirector: "preview-campaign-director",
  reservationBooked: "preview-reservation-booked",
  reservationHold: "preview-reservation-hold",
  upload: "preview-financial-upload",
  receivableOverdue: "preview-receivable-overdue",
  receivableDueSoon: "preview-receivable-due-soon",
  receivablePaid: "preview-receivable-paid",
  paymentPartial: "preview-payment-partial",
  paymentPaid: "preview-payment-paid",
  crmCompany: "preview-crm-company",
  crmContact: "preview-crm-contact",
  crmProspect: "preview-crm-prospect",
  crmOpportunity: "preview-crm-opportunity",
  crmAction: "preview-crm-action",
  proof: "preview-proof-photo"
} as const;

function day(offset: number) {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offset);
  return value;
}

async function main() {
  const passwordHash = await hashPassword(password);
  const users = new Map<UserRole, { id: string; email: string; name: string }>();
  for (const account of accounts) {
    const role = account.role as UserRole;
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: { name: account.name, role, active: true, passwordHash },
      create: { email: account.email, name: account.name, role, active: true, passwordHash }
    });
    users.set(role, user);
  }
  const coo = requiredUser(users, "COO");
  const director = requiredUser(users, "SALES_DIRECTOR");
  const agent = requiredUser(users, "SALES_AGENT");
  const finance = requiredUser(users, "FINANCE_OPERATOR");
  const field = requiredUser(users, "FIELD_OPERATOR");

  await prisma.category.upsert({
    where: { id: ids.category },
    update: { name: "Preview București", slug: "preview-bucuresti", description: "Inventar exclusiv sintetic", sortOrder: -100 },
    create: { id: ids.category, name: "Preview București", slug: "preview-bucuresti", description: "Inventar exclusiv sintetic", sortOrder: -100 }
  });

  const locations = [
    { id: ids.availableLocation, code: "PV-AVAILABLE-01", address: "Piața Preview 1", mainPhotoUrl: "/samples/EPZP7A.svg", status: "AVAILABLE" as const },
    { id: ids.bookedLocation, code: "PV-BOOKED-01", address: "Bulevardul Preview 2", mainPhotoUrl: "/samples/EPZP8A.svg", status: "BOOKED" as const },
    { id: ids.holdLocation, code: "PV-HOLD-01", address: "Șoseaua Preview 3", mainPhotoUrl: "/samples/SZPP7.svg", status: "RESERVED" as const }
  ];
  for (const [index, location] of locations.entries()) {
    await prisma.location.upsert({
      where: { id: location.id },
      update: {
        categoryId: ids.category, code: location.code, nr: location.code, city: "București", county: "București",
        address: location.address, type: "Billboard Preview", size: "4 x 3 m", sqm: 12, illum: true,
        status: location.status, lifecycleStatus: "ACTIVE", latReal: 44.43 + index * 0.01, lngReal: 26.1 + index * 0.01,
        latDisplay: 44.43 + index * 0.01, lngDisplay: 26.1 + index * 0.01, mainPhotoUrl: location.mainPhotoUrl,
        showInPublic: true, showPricePublic: false, showInstallationCostPublic: false, availabilityText: "Date sintetice Preview",
        isFeatured: index === 0, isPremium: index === 0, gpsAuditStatus: "OK", coordinateSource: "synthetic-preview"
      },
      create: {
        id: location.id, categoryId: ids.category, code: location.code, nr: location.code, city: "București", county: "București",
        address: location.address, type: "Billboard Preview", size: "4 x 3 m", sqm: 12, illum: true,
        status: location.status, lifecycleStatus: "ACTIVE", latReal: 44.43 + index * 0.01, lngReal: 26.1 + index * 0.01,
        latDisplay: 44.43 + index * 0.01, lngDisplay: 26.1 + index * 0.01, mainPhotoUrl: location.mainPhotoUrl,
        showInPublic: true, showPricePublic: false, showInstallationCostPublic: false, availabilityText: "Date sintetice Preview",
        isFeatured: index === 0, isPremium: index === 0, gpsAuditStatus: "OK", coordinateSource: "synthetic-preview"
      }
    });
    await prisma.image.upsert({
      where: { id: `${location.id}-main` },
      update: { locationId: location.id, url: location.mainPhotoUrl, alt: `${location.code} - imagine sintetică`, isMain: true, sortOrder: 0 },
      create: { id: `${location.id}-main`, locationId: location.id, url: location.mainPhotoUrl, alt: `${location.code} - imagine sintetică`, isMain: true, sortOrder: 0 }
    });
  }

  await prisma.clientAccount.upsert({
    where: { id: ids.clientAgent },
    update: { companyName: "Retail Preview SRL", normalizedName: "retail preview", taxId: "ROPREVIEW001", generalEmail: "contact@retail.preview.test", accountOwnerUserId: agent.id, status: "active", notes: "Date sintetice" },
    create: { id: ids.clientAgent, companyName: "Retail Preview SRL", normalizedName: "retail preview", taxId: "ROPREVIEW001", generalEmail: "contact@retail.preview.test", accountOwnerUserId: agent.id, createdByUserId: coo.id, status: "active", notes: "Date sintetice" }
  });
  await prisma.clientAccount.upsert({
    where: { id: ids.clientDirector },
    update: { companyName: "Mobility Preview SA", normalizedName: "mobility preview", taxId: "ROPREVIEW002", generalEmail: "contact@mobility.preview.test", accountOwnerUserId: director.id, status: "active", notes: "Date sintetice" },
    create: { id: ids.clientDirector, companyName: "Mobility Preview SA", normalizedName: "mobility preview", taxId: "ROPREVIEW002", generalEmail: "contact@mobility.preview.test", accountOwnerUserId: director.id, createdByUserId: coo.id, status: "active", notes: "Date sintetice" }
  });
  await prisma.clientContact.upsert({
    where: { id: "preview-client-contact" },
    update: { clientId: ids.clientAgent, name: "Contact Preview", email: "buyer@retail.preview.test", phone: "+40000000000", role: "Marketing", isPrimary: true },
    create: { id: "preview-client-contact", clientId: ids.clientAgent, name: "Contact Preview", email: "buyer@retail.preview.test", phone: "+40000000000", role: "Marketing", isPrimary: true }
  });

  await prisma.campaign.upsert({
    where: { id: ids.campaignAgent },
    update: { clientId: ids.clientAgent, campaignName: "Campanie Retail Preview", campaignCode: "PV-CAMP-001", status: "active", accountOwnerUserId: agent.id, sellerUserId: agent.id, startDate: day(-5), endDate: day(25), currency: "EUR", totalContractValue: new Prisma.Decimal("4200.00") },
    create: { id: ids.campaignAgent, clientId: ids.clientAgent, campaignName: "Campanie Retail Preview", campaignCode: "PV-CAMP-001", status: "active", accountOwnerUserId: agent.id, sellerUserId: agent.id, createdByUserId: coo.id, companyEntity: "Focus Media", startDate: day(-5), endDate: day(25), currency: "EUR", totalContractValue: new Prisma.Decimal("4200.00") }
  });
  await prisma.campaign.upsert({
    where: { id: ids.campaignDirector },
    update: { clientId: ids.clientDirector, campaignName: "Campanie Mobility Preview", campaignCode: "PV-CAMP-002", status: "active", accountOwnerUserId: director.id, sellerUserId: director.id, startDate: day(3), endDate: day(33), currency: "RON", totalContractValue: new Prisma.Decimal("18000.00") },
    create: { id: ids.campaignDirector, clientId: ids.clientDirector, campaignName: "Campanie Mobility Preview", campaignCode: "PV-CAMP-002", status: "active", accountOwnerUserId: director.id, sellerUserId: director.id, createdByUserId: coo.id, companyEntity: "Excellence Media", startDate: day(3), endDate: day(33), currency: "RON", totalContractValue: new Prisma.Decimal("18000.00") }
  });

  await prisma.reservation.upsert({
    where: { id: ids.reservationBooked },
    update: { locationId: ids.bookedLocation, clientId: ids.clientAgent, campaignId: ids.campaignAgent, status: "BOOKED", clientName: "Retail Preview SRL", campaignName: "Campanie Retail Preview", periodStart: day(-5), periodEnd: day(25), installationDate: day(-6), neutralizationDate: day(25), bookedAt: day(-10), holdExpiresAt: null, sellerUserId: agent.id, ownerId: coo.id, amount: 4200, currency: "EUR" },
    create: { id: ids.reservationBooked, locationId: ids.bookedLocation, clientId: ids.clientAgent, campaignId: ids.campaignAgent, status: "BOOKED", clientName: "Retail Preview SRL", campaignName: "Campanie Retail Preview", periodStart: day(-5), periodEnd: day(25), installationDate: day(-6), neutralizationDate: day(25), bookedAt: day(-10), sellerUserId: agent.id, ownerId: coo.id, amount: 4200, currency: "EUR", productionNotes: JSON.stringify({ decorationStatus: "PENDING", synthetic: true }) }
  });
  await prisma.reservation.upsert({
    where: { id: ids.reservationHold },
    update: { locationId: ids.holdLocation, clientId: ids.clientDirector, campaignId: ids.campaignDirector, status: "HOLD", clientName: "Mobility Preview SA", campaignName: "Campanie Mobility Preview", periodStart: day(3), periodEnd: day(33), holdExpiresAt: day(2), sellerUserId: director.id, ownerId: coo.id, amount: 18000, currency: "RON" },
    create: { id: ids.reservationHold, locationId: ids.holdLocation, clientId: ids.clientDirector, campaignId: ids.campaignDirector, status: "HOLD", clientName: "Mobility Preview SA", campaignName: "Campanie Mobility Preview", periodStart: day(3), periodEnd: day(33), holdExpiresAt: day(2), sellerUserId: director.id, ownerId: coo.id, amount: 18000, currency: "RON" }
  });

  await prisma.financialReportUpload.upsert({
    where: { id: ids.upload },
    update: { uploadedByUserId: finance.id, reportDate: day(0), originalFileName: "preview-synthetic.xlsx", fileHash: "preview-synthetic-v1", status: "confirmed", activeVersion: true },
    create: { id: ids.upload, uploadedByUserId: finance.id, reportDate: day(0), originalFileName: "preview-synthetic.xlsx", fileHash: "preview-synthetic-v1", status: "confirmed", activeVersion: true }
  });
  await upsertReceivable(ids.receivableOverdue, { clientId: ids.clientAgent, campaignId: ids.campaignAgent, ownerId: agent.id, companyName: "Focus Media", companyCode: "FOCUS", invoiceNumber: "PV-OVERDUE-001", clientName: "Retail Preview SRL", dueDate: day(-12), invoiced: "4000.00", collected: "1000.00", remaining: "3000.00", currency: "EUR", status: "overdue" });
  await upsertReceivable(ids.receivableDueSoon, { clientId: ids.clientDirector, campaignId: ids.campaignDirector, ownerId: director.id, companyName: "Excellence Media", companyCode: "EXCELLENCE", invoiceNumber: "PV-DUE-001", clientName: "Mobility Preview SA", dueDate: day(5), invoiced: "18000.00", collected: "0.00", remaining: "18000.00", currency: "RON", status: "in_term" });
  await upsertReceivable(ids.receivablePaid, { clientId: ids.clientAgent, campaignId: ids.campaignAgent, ownerId: agent.id, companyName: "Focus Media", companyCode: "FOCUS", invoiceNumber: "PV-PAID-001", clientName: "Retail Preview SRL", dueDate: day(-2), invoiced: "1200.00", collected: "1200.00", remaining: "0.00", currency: "EUR", status: "collected" });
  await prisma.financialReceivablePayment.upsert({ where: { id: ids.paymentPartial }, update: { receivableId: ids.receivableOverdue, amount: new Prisma.Decimal("1000.00"), currency: "EUR", receivedAt: day(-15), source: "synthetic_preview", status: "active", createdByUserId: finance.id }, create: { id: ids.paymentPartial, receivableId: ids.receivableOverdue, amount: new Prisma.Decimal("1000.00"), currency: "EUR", receivedAt: day(-15), source: "synthetic_preview", status: "active", requestKey: "preview-payment-partial", createdByUserId: finance.id } });
  await prisma.financialReceivablePayment.upsert({ where: { id: ids.paymentPaid }, update: { receivableId: ids.receivablePaid, amount: new Prisma.Decimal("1200.00"), currency: "EUR", receivedAt: day(-3), source: "synthetic_preview", status: "active", createdByUserId: finance.id }, create: { id: ids.paymentPaid, receivableId: ids.receivablePaid, amount: new Prisma.Decimal("1200.00"), currency: "EUR", receivedAt: day(-3), source: "synthetic_preview", status: "active", requestKey: "preview-payment-paid", createdByUserId: finance.id } });

  await prisma.crmCompany.upsert({ where: { id: ids.crmCompany }, update: { name: "Prospect Preview Industries", normalizedName: "prospect preview industries", normalizedTaxId: "ROPREVIEWCRM", taxId: "ROPREVIEWCRM", industry: "Retail", ownerId: agent.id, createdByUserId: agent.id, status: "prospect" }, create: { id: ids.crmCompany, name: "Prospect Preview Industries", normalizedName: "prospect preview industries", normalizedTaxId: "ROPREVIEWCRM", taxId: "ROPREVIEWCRM", industry: "Retail", ownerId: agent.id, createdByUserId: agent.id, status: "prospect" } });
  await prisma.crmCompanyContact.upsert({ where: { id: ids.crmContact }, update: { companyId: ids.crmCompany, name: "Decident Preview", email: "decident@prospect.preview.test", normalizedEmail: "decident@prospect.preview.test", role: "Marketing Director", isDecisionMaker: true, isPrimary: true, createdByUserId: agent.id }, create: { id: ids.crmContact, companyId: ids.crmCompany, name: "Decident Preview", email: "decident@prospect.preview.test", normalizedEmail: "decident@prospect.preview.test", role: "Marketing Director", isDecisionMaker: true, isPrimary: true, createdByUserId: agent.id } });
  await prisma.crmProspect.upsert({ where: { id: ids.crmProspect }, update: { companyId: ids.crmCompany, ownerId: agent.id, createdByUserId: agent.id, source: "synthetic_preview", status: "qualified", priority: "high", contactState: "contacted", initialSnapshot: { synthetic: true }, qualifiedAt: day(-2) }, create: { id: ids.crmProspect, companyId: ids.crmCompany, ownerId: agent.id, createdByUserId: agent.id, source: "synthetic_preview", status: "qualified", priority: "high", contactState: "contacted", initialSnapshot: { synthetic: true }, qualifiedAt: day(-2) } });
  await prisma.crmOpportunity.upsert({ where: { id: ids.crmOpportunity }, update: { companyId: ids.crmCompany, sourceProspectId: ids.crmProspect, ownerId: agent.id, createdByUserId: agent.id, name: "Rețea OOH Preview", stage: "negotiation", needSummary: "Campanie urbană sintetică", quotedValue: new Prisma.Decimal("4000.00"), revisedValue: new Prisma.Decimal("4000.00"), currency: "EUR", decisionDate: day(8), initialSnapshot: { synthetic: true } }, create: { id: ids.crmOpportunity, companyId: ids.crmCompany, sourceProspectId: ids.crmProspect, ownerId: agent.id, createdByUserId: agent.id, name: "Rețea OOH Preview", stage: "negotiation", needSummary: "Campanie urbană sintetică", quotedValue: new Prisma.Decimal("4000.00"), revisedValue: new Prisma.Decimal("4000.00"), currency: "EUR", decisionDate: day(8), initialSnapshot: { synthetic: true } } });
  await prisma.crmNextAction.upsert({ where: { id: ids.crmAction }, update: { companyId: ids.crmCompany, prospectId: ids.crmProspect, opportunityId: ids.crmOpportunity, ownerId: agent.id, createdByUserId: agent.id, type: "call", description: "Follow-up sintetic Preview", dueAt: day(0), priority: "high", status: "open" }, create: { id: ids.crmAction, companyId: ids.crmCompany, prospectId: ids.crmProspect, opportunityId: ids.crmOpportunity, ownerId: agent.id, createdByUserId: agent.id, type: "call", description: "Follow-up sintetic Preview", dueAt: day(0), priority: "high", status: "open" } });

  await prisma.clientDocument.upsert({ where: { id: ids.proof }, update: { clientId: ids.clientAgent, campaignId: ids.campaignAgent, reservationId: ids.reservationBooked, fileName: "preview-proof.png", fileType: "image/png", fileSize: 68, documentType: "operational_proof_photo", uploadedByUserId: field.id, expiryDate: day(30), notes: JSON.stringify({ synthetic: true }), storageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", status: "active" }, create: { id: ids.proof, clientId: ids.clientAgent, campaignId: ids.campaignAgent, reservationId: ids.reservationBooked, fileName: "preview-proof.png", fileType: "image/png", fileSize: 68, documentType: "operational_proof_photo", uploadedByUserId: field.id, expiryDate: day(30), notes: JSON.stringify({ synthetic: true }), storageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", status: "active" } });

  for (const [role, user] of users.entries()) {
    await prisma.appNotification.upsert({
      where: { id: `preview-notification-${role.toLowerCase()}` },
      update: { userId: user.id, type: "preview_release", title: "Notificare sintetică Preview", message: "Această notificare există doar în mediul izolat.", severity: "low", status: "open", dueDate: day(1), metadata: { synthetic: true } },
      create: { id: `preview-notification-${role.toLowerCase()}`, userId: user.id, type: "preview_release", title: "Notificare sintetică Preview", message: "Această notificare există doar în mediul izolat.", severity: "low", status: "open", dueDate: day(1), metadata: { synthetic: true } }
    });
  }

  console.log(JSON.stringify({ ok: true, dataset: process.env.PREVIEW_DATASET_ID, databaseFingerprint: identity.fingerprint, roles: [...users.keys()], syntheticLocations: locations.length }, null, 2));
}

async function upsertReceivable(id: string, row: { clientId: string; campaignId: string; ownerId: string; companyName: string; companyCode: string; invoiceNumber: string; clientName: string; dueDate: Date; invoiced: string; collected: string; remaining: string; currency: string; status: string }) {
  const data = {
    uploadId: ids.upload, clientId: row.clientId, campaignId: row.campaignId, accountOwnerUserId: row.ownerId,
    companyName: row.companyName, companyCode: row.companyCode, invoiceNumber: row.invoiceNumber,
    normalizedInvoiceNumber: row.invoiceNumber, canonicalKey: `preview|${row.companyCode}|${row.invoiceNumber}|${row.currency}`,
    invoiceDate: day(-20), dueDate: row.dueDate, clientName: row.clientName, location: "Locație sintetică Preview",
    campaignDetails: "Campanie sintetică Preview", invoicedAmount: new Prisma.Decimal(row.invoiced),
    collectedAmount: new Prisma.Decimal(row.collected), remainingAmount: new Prisma.Decimal(row.remaining),
    currency: row.currency, status: row.status, includedInReport: true, rowType: "invoice", needsReview: false,
    rawRowJson: { synthetic: true }, lastReportDate: day(0), lastImportedAt: day(0)
  };
  await prisma.financialReceivable.upsert({ where: { id }, update: data, create: { id, ...data } });
}

function requiredUser(users: Map<UserRole, { id: string; email: string; name: string }>, role: UserRole) {
  const user = users.get(role);
  if (!user) throw new Error(`Lipsește contul sintetic ${role}.`);
  return user;
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
