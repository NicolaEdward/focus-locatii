import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID, randomBytes, scryptSync } from "node:crypto";
import ts from "typescript";
import { NextRequest } from "next/server";
import { request as playwrightRequest } from "playwright";
import { prisma } from "../src/lib/prisma";
import type { AuthSession } from "../src/lib/auth";
import * as documentAccess from "../src/lib/client-document-access";
import { OPERATIONAL_PROOF_DOCUMENT_TYPE } from "../src/lib/operational-proof";
import { createCommercialQuote, recordCommercialAcceptance, commercialWorkspace } from "../src/lib/commercial-workbench";
import { assertSyntheticEnvironment } from "./release/env-utils";

assertSyntheticEnvironment();
const db = new URL(process.env.DATABASE_URL || "invalid:");
assert.ok(["127.0.0.1", "localhost"].includes(db.hostname) && db.pathname.startsWith("/focus_preview_"));
assert.notEqual(process.env.NODE_ENV, "production");
const baseline = process.argv.includes("--http-baseline");
const base = process.env.OOH_SIMULATION_ORIGIN || "http://127.0.0.1:3041";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const tag = "SIM-OOH-doc-handoff-" + randomUUID();
const userIds: string[] = [], clientIds: string[] = [], campaignIds: string[] = [], quoteIds: string[] = [];
let categoryId = "", locationId = "", http: Awaited<ReturnType<typeof playwrightRequest.newContext>> | undefined;
let policyCreated = false;
const checks: Array<Record<string, unknown>> = [];
function passwordHash(password: string) { const salt = randomBytes(16); return `scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, 64).toString("base64url")}`; }
async function actor(suffix: string, password: string): Promise<AuthSession> { const row = await prisma.user.create({ data: { role: "SALES_AGENT", name: tag + suffix, email: tag + suffix + "@example.invalid", active: true, passwordHash: passwordHash(password) } }); userIds.push(row.id); return { ...row, iat: 1, exp: 9999999999 }; }
function uploadHandler(actor: AuthSession) {
  const require = createRequire(`${process.cwd()}/package.json`);
  const mocks: Record<string, unknown> = { "@/lib/auth": { requireAnyPermission: async () => ({ session: actor, response: null }) }, "@/lib/prisma": { prisma }, "@/lib/client-document-access": documentAccess, "@/lib/operational-proof": { OPERATIONAL_PROOF_DOCUMENT_TYPE } };
  const compiled = ts.transpileModule(fs.readFileSync("src/app/api/admin/client-documents/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exported: { POST?: (request: NextRequest) => Promise<Response> } = {};
  runInNewContext(compiled.outputText, { exports: exported, require: (name: string) => name in mocks ? mocks[name] : require(name), Buffer, Request, File, URL, Error });
  return (fields: Record<string, string>) => { const form = new FormData(); for (const [key, value] of Object.entries(fields)) form.set(key, value); return exported.POST!(new NextRequest(base + "/api/admin/client-documents", { method: "POST", body: form })); };
}
async function main() {
  const password = "Synthetic-" + randomBytes(24).toString("base64url"), seller = await actor("seller", password), other = await actor("other", password);
  if (!await prisma.commercialPolicy.findUnique({ where: { id: "default" } })) {
    const manager = await prisma.user.create({ data: { role: "COO", name: tag + "manager", email: tag + "manager@example.invalid", active: true, passwordHash: "synthetic-unused" } });
    userIds.push(manager.id);
    await prisma.commercialPolicy.create({ data: { id: "default", vatRateBps: 2100, vatTreatment: "exclusive", rateCardCurrency: "EUR", approvedByUserId: manager.id } });
    policyCreated = true;
  }
  for (let n = 0; n < 3; n++) { const row = await prisma.clientAccount.create({ data: { companyName: tag + n, normalizedName: tag + n, accountOwnerUserId: n === 2 ? other.id : seller.id } }); clientIds.push(row.id); const campaign = await prisma.campaign.create({ data: { clientId: row.id, campaignName: tag + n, sellerUserId: n === 2 ? other.id : seller.id, accountOwnerUserId: n === 2 ? other.id : seller.id, status: "draft", currency: "EUR", companyEntity: "Focus Media", paymentTermType: "15_days", paymentTermDays: 15, billingRule: "monthly_after_service", billingFrequency: "monthly" } }); campaignIds.push(campaign.id); }
  const cat = await prisma.category.create({ data: { name: tag, slug: tag } }); categoryId = cat.id;
  const location = await prisma.location.create({ data: { code: tag, categoryId, lifecycleStatus: "ACTIVE", city: "SIM-OOH Bucuresti", type: "Billboard", showInPublic: false, rateCardValue: 100 } }); locationId = location.id;
  const quoteInput = { clientId: clientIds[0], campaignId: campaignIds[0], recipient: "synthetic@example.invalid", companyEntity: "Focus Media", periodStart: "2097-01-01", periodEnd: "2097-01-31", locationIds: [locationId], requestKey: randomUUID() };
  const documentInput = { campaignId: campaignIds[0], documentType: "contract", storageUrl: "https://example.invalid/SIM-OOH-signed-contract.pdf", fileName: tag + ".pdf" };
  let quote: { quote: { id: string }; revision: { id: string } };
  let documentId: string;
  if (baseline) {
    http = await playwrightRequest.newContext({ baseURL: base, extraHTTPHeaders: { origin: base } });
    const login = await http.post("/api/auth/login", { data: { email: seller.email, password } }); assert.equal(login.status(), 200, "Real synthetic authentication must pass");
    // The app is a production build on isolated loopback HTTP. Keep the real
    // server-issued session and auth registry; adapt only its transport flag for
    // Playwright's API client, which refuses Secure cookies on this local HTTP.
    const state = await http.storageState();
    assert.ok(state.cookies.length, "Login must issue a real registered session cookie");
    await http.dispose();
    http = await playwrightRequest.newContext({ baseURL: base, extraHTTPHeaders: { origin: base }, storageState: { ...state, cookies: state.cookies.map((cookie) => ({ ...cookie, secure: false })) } });
    const quoteResponse = await http.post("/api/admin/commercial-workbench", { data: { action: "quote.create", input: quoteInput } }); assert.equal(quoteResponse.status(), 200, await quoteResponse.text()); quote = (await quoteResponse.json()).result; quoteIds.push(quote.quote.id);
    const uploaded = await http.post("/api/admin/client-documents", { multipart: documentInput }); assert.equal(uploaded.status(), 201); documentId = (await uploaded.json()).document.id;
    const row = await prisma.clientDocument.findUniqueOrThrow({ where: { id: documentId } });
    const workspaceResponse = await http.get("/api/admin/commercial-workbench?q=" + encodeURIComponent(tag)); const workspace = await workspaceResponse.json();
    const selectorContainsUploadedDocument = workspace.documents.some((document: { id: string }) => document.id === documentId);
    const accepted = await http.post("/api/admin/commercial-workbench", { data: { action: "quote.acceptance", input: { revisionId: quote.revision.id, decision: "accepted", evidenceReference: "SIM-OOH client accepted signed contract", documentId, requestKey: randomUUID() } } });
    checks.push({ id: "DOC-CAMPAIGN-HANDOFF", authenticatedHttp: true, uploadStatus: uploaded.status(), persistedClientIdMatches: row.clientId === clientIds[0], persistedClientIdWasNull: row.clientId === null, selectorContainsUploadedDocument, acceptanceStatus: accepted.status(), acceptanceCode: (await accepted.json()).code });
  } else {
    quote = await createCommercialQuote(quoteInput, seller); quoteIds.push(quote.quote.id);
    const upload = uploadHandler(seller);
    const uploaded = await upload(documentInput); assert.equal(uploaded.status, 201); const dto = (await uploaded.json()).document; documentId = dto.id;
    assert.equal(dto.storageUrl, undefined);
    const row = await prisma.clientDocument.findUniqueOrThrow({ where: { id: documentId } }); assert.equal(row.clientId, clientIds[0]); assert.equal(row.campaignId, campaignIds[0]);
    const workspace = await commercialWorkspace(seller, { q: tag }); assert.ok(workspace.documents.some((document) => document.id === documentId));
    const accepted = await recordCommercialAcceptance({ revisionId: quote.revision.id, decision: "accepted", evidenceReference: "SIM-OOH client accepted signed contract", documentId, requestKey: randomUUID() }, seller); assert.equal(accepted.documentId, documentId);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: documentId, action: "document.upload" } }); assert.equal((audit.metadata as { clientId: string }).clientId, clientIds[0]);
    checks.push({ id: "DOC-CAMPAIGN-HANDOFF", uploadStatus: 201, persistedClientIdMatches: true, selectorContainsUploadedDocument: true, acceptancePersisted: true, canonicalClientInAudit: true, privateResponseNoStorage: true });
    const count = await prisma.clientDocument.count({ where: { uploadedByUserId: seller.id } });
    for (const [id, fields, status] of [["DOC-EXPLICIT-MISMATCH", { ...documentInput, clientId: clientIds[1] }, 422], ["DOC-FOREIGN-CAMPAIGN", { ...documentInput, campaignId: campaignIds[2] }, 403], ["DOC-MISSING-CAMPAIGN", { ...documentInput, campaignId: "missing-synthetic-campaign" }, 404]] as const) {
      const response = await upload(fields); assert.equal(response.status, status, await response.text()); assert.equal(await prisma.clientDocument.count({ where: { uploadedByUserId: seller.id } }), count); checks.push({ id, status, zeroWrites: true });
    }
    const explicit = await upload({ ...documentInput, clientId: clientIds[0] }); assert.equal(explicit.status, 201); checks.push({ id: "DOC-EXPLICIT-CONSISTENT", status: 201 });
    const foreign = await uploadHandler(other)({ ...documentInput, campaignId: campaignIds[2] }); assert.equal(foreign.status, 201); const foreignId = (await foreign.json()).document.id;
    await assert.rejects(() => recordCommercialAcceptance({ revisionId: quote.revision.id, decision: "accepted", evidenceReference: "SIM-OOH invalid foreign evidence", documentId: foreignId, requestKey: randomUUID() }, seller), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "DOCUMENT_LINK_INVALID")); checks.push({ id: "DOC-FOREIGN-ACCEPTANCE", rejected: true });
  }
  const result = { schema_version: "1.0", baseline, scenario: "campaign document upload -> offer evidence selector -> client acceptance", fixtureTag: tag, externalFetches: 0, productionWrites: 0, checks };
  if (process.env.CAMPAIGN_DOCUMENT_RESULT) { const output = process.env.CAMPAIGN_DOCUMENT_RESULT; fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n"); }
  console.log(JSON.stringify(result, null, 2));
}
async function cleanup() {
  const revisions = await prisma.quoteRevision.findMany({ where: { quoteId: { in: quoteIds } }, select: { id: true } });
  await prisma.commercialAcceptance.deleteMany({ where: { revisionId: { in: revisions.map((row) => row.id) } } });
  await prisma.quoteRevision.deleteMany({ where: { quoteId: { in: quoteIds } } }); await prisma.commercialQuote.deleteMany({ where: { id: { in: quoteIds } } });
  await prisma.clientDocument.deleteMany({ where: { uploadedByUserId: { in: userIds } } }); await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } }); await prisma.clientAccount.deleteMany({ where: { id: { in: clientIds } } });
  if (locationId) await prisma.location.delete({ where: { id: locationId } }); if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  if (policyCreated) await prisma.commercialPolicy.deleteMany({ where: { id: "default" } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }); await http?.dispose();
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { try { await cleanup(); } finally { await prisma.$disconnect(); } });
