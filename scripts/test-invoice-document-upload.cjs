"use strict";

// In-process route regression. All records and writes stay in memory; no
// database client, HTTP request, external storage or filesystem upload is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { NextResponse } = require("next/server");
const { loadTsModule } = require("./load-ts-module.cjs");

const owner = "SIM-OOH-owner";
const clients = new Map([
  ["SIM-OOH-client-1", { id: "SIM-OOH-client-1", accountOwnerUserId: owner }],
  ["SIM-OOH-client-2", { id: "SIM-OOH-client-2", accountOwnerUserId: owner }],
]);
const campaign = (id, clientId) => ({ id, clientId, accountOwnerUserId: owner, sellerUserId: owner, client: { accountOwnerUserId: owner } });
const campaigns = new Map([
  ["SIM-OOH-campaign-1", campaign("SIM-OOH-campaign-1", "SIM-OOH-client-1")],
  ["SIM-OOH-campaign-2", campaign("SIM-OOH-campaign-2", "SIM-OOH-client-1")],
  ["SIM-OOH-campaign-3", campaign("SIM-OOH-campaign-3", "SIM-OOH-client-2")],
]);
const invoice = (id, clientId, campaignId) => ({ id, clientId, campaignId, billingItemId: null, campaign: campaignId ? { clientId } : null, billingItem: null, client: { accountOwnerUserId: owner } });
const invoices = new Map([
  ["SIM-OOH-invoice-1", invoice("SIM-OOH-invoice-1", "SIM-OOH-client-1", "SIM-OOH-campaign-1")],
  ["SIM-OOH-unallocated-invoice", invoice("SIM-OOH-unallocated-invoice", "SIM-OOH-client-1", null)],
]);
const documents = [];
const audits = [];
const documentQueries = [];
let lockQueries = 0;
const model = (records) => ({
  findUnique: async ({ where }) => records.get(where.id) || null,
  findMany: async ({ where }) => [...records.values()].filter(row => where.id.in.includes(row.id)),
});
const empty = () => model(new Map());
const prisma = {
  clientAccount: model(clients), campaign: model(campaigns),
  financialReceivable: model(invoices), reservation: empty(),
  billingItem: empty(), financialPayable: empty(), supplier: empty(),
  clientDocument: {
    create: async ({ data }) => {
      const row = { ...data, id: `SIM-OOH-document-${documents.length + 1}`, uploadedAt: new Date("2026-11-13T12:00:00Z") };
      documents.push(row);
      return row;
    },
    findMany: async (query) => {
      documentQueries.push(query);
      let rows = documents.filter(row => Object.entries(query.where || {}).every(([key, value]) => value && typeof value === "object" && Object.hasOwn(value, "not") ? row[key] !== value.not : row[key] === value));
      for (const order of [...(query.orderBy || [])].reverse()) {
        const [key, direction] = Object.entries(order)[0];
        rows = rows.sort((left, right) => (left[key] instanceof Date
          ? left[key].getTime() - right[key].getTime()
          : String(left[key]).localeCompare(String(right[key]))) * (direction === "desc" ? -1 : 1));
      }
      rows = rows.slice(0, query.take);
      return rows.map(row => query.select ? Object.fromEntries(Object.entries(query.select).map(([key, selected]) => [key, key === "uploadedBy" && selected ? { name: "SIM-OOH finance" } : row[key]])) : { ...row });
    },
  },
  auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  $queryRaw: async () => { lockQueries++; return []; },
  $transaction: async (callback) => callback(prisma),
};

const { hasPermission } = loadTsModule(path.join(process.cwd(), "src/lib/rbac.ts"));
const access = loadTsModule(path.join(process.cwd(), "src/lib/client-document-access.ts"), { "@/lib/prisma": { prisma } });
const actor = { id: "SIM-OOH-finance", role: "FINANCE_OPERATOR", email: "sim-ooh-finance@example.invalid", name: "SIM-OOH finance", tokenVersion: 1, iat: 1, exp: 9999999999 };
const mocks = {
  "@/lib/auth": {
    requireAnyPermission: async (_request, permissions) => permissions.some(permission => hasPermission(actor.role, permission))
      ? { session: actor, response: null }
      : { session: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
  },
  "@/lib/prisma": { prisma },
  "@/lib/client-document-access": access,
  "@/lib/operational-proof": { OPERATIONAL_PROOF_DOCUMENT_TYPE: "operational_proof_photo" },
};

function loadRoute(relativePath) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(process.cwd(), relativePath), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const exported = {};
  vm.runInNewContext(compiled.outputText, { exports: exported, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), Buffer, Request, File, URL, Error });
  return exported;
}

const upload = loadRoute("src/app/api/admin/client-documents/route.ts").POST;
const list = loadRoute("src/app/api/admin/receivables/[id]/documents/route.ts").GET;
const checks = [];
async function checkUpload(id, links, expectedStatus) {
  const before = documents.length;
  const form = new FormData();
  for (const [key, value] of Object.entries(links)) form.set(key, value);
  form.set("documentType", "other");
  form.set("file", new File(["%PDF-1.4\nSIM-OOH FICTIONAL INVOICE. NO REAL FISCAL ISSUANCE.\n%%EOF"], "SIM-OOH-INVOICE.pdf", { type: "application/pdf" }));
  const response = await upload(new Request("http://synthetic.example.invalid/api/admin/client-documents", { method: "POST", body: form }));
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, `${id}: ${JSON.stringify(payload)}`);
  if (expectedStatus === 201) {
    assert.equal(documents.length, before + 1);
    assert.equal(documents.at(-1).financialReceivableId, links.financialReceivableId);
    assert.equal(payload.document.fileName, "SIM-OOH-INVOICE.pdf");
    assert.equal(payload.document.storageUrl, undefined, "Upload response must not expose the private file payload.");
    assert.equal(audits.at(-1).action, "document.upload");
    assert.equal(audits.at(-1).metadata.financialReceivableId, links.financialReceivableId);
  } else {
    assert.equal(documents.length, before, `${id}: a rejected document upload wrote a record.`);
  }
  checks.push({ id, status: response.status, recordsCreated: documents.length - before });
}

async function checkList(id, invoiceId, expectedStatus) {
  const before = documentQueries.length;
  const response = await list(new Request(`http://synthetic.example.invalid/api/admin/receivables/${invoiceId}/documents`), { params: Promise.resolve({ id: invoiceId }) });
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, `${id}: ${JSON.stringify(payload)}`);
  if (expectedStatus === 200) {
    assert.equal(documentQueries.length, before + 1);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    for (const row of payload.documents) {
      assert.equal(row.storageUrl, undefined, "Invoice document lists must not expose file contents.");
      assert.equal(row.notes, undefined, "Invoice document lists must not expose private document notes.");
      assert.equal(row.uploadedByUserId, undefined, "Invoice document lists must not expose uploader identifiers.");
      for (const key of ["clientId", "campaignId", "reservationId", "billingItemId", "financialReceivableId", "financialPayableId"]) {
        assert.equal(row[key], undefined, `Invoice document lists must keep internal ${key} authorization fields private.`);
      }
      assert.equal(row.uploadedByName, "SIM-OOH finance");
      assert.equal(row.expiryDate, null);
    }
  } else {
    assert.equal(documentQueries.length, before, "Rejected metadata requests must not query document records.");
  }
  checks.push({ id, status: response.status, documentQueries: documentQueries.length - before });
  return payload;
}

async function main() {
  await checkUpload("finance-invoice-linked-upload", { financialReceivableId: "SIM-OOH-invoice-1" }, 201);
  await checkUpload("finance-unallocated-invoice-linked-upload", { financialReceivableId: "SIM-OOH-unallocated-invoice" }, 201);
  await checkUpload("same-invoice-client-and-campaign", { financialReceivableId: "SIM-OOH-invoice-1", clientId: "SIM-OOH-client-1", campaignId: "SIM-OOH-campaign-1" }, 201);
  await checkUpload("invoice-with-another-client-denied", { financialReceivableId: "SIM-OOH-invoice-1", clientId: "SIM-OOH-client-2" }, 422);
  await checkUpload("invoice-with-another-campaign-same-client-denied", { financialReceivableId: "SIM-OOH-invoice-1", campaignId: "SIM-OOH-campaign-2" }, 422);
  await checkUpload("invoice-with-another-campaign-client-denied", { financialReceivableId: "SIM-OOH-invoice-1", campaignId: "SIM-OOH-campaign-3" }, 422);
  await checkUpload("unallocated-invoice-cannot-invent-campaign", { financialReceivableId: "SIM-OOH-unallocated-invoice", campaignId: "SIM-OOH-campaign-1" }, 422);
  await checkUpload("finance-generic-campaign-document-denied", { campaignId: "SIM-OOH-campaign-1" }, 403);
  await checkUpload("finance-generic-client-document-denied", { clientId: "SIM-OOH-client-1" }, 403);
  await checkUpload("missing-invoice-denied", { financialReceivableId: "SIM-OOH-missing-invoice" }, 404);
  assert.ok(lockQueries > 0, "Accepted invoice attachments must acquire the existing linked-entity locks.");
  // An inactive record and another invoice must remain outside the exact
  // selected-invoice list even when their metadata is newer.
  documents.push({ ...documents[0], id: "SIM-OOH-inactive-document", status: "archived", uploadedAt: new Date("2098-01-01") });
  const metadata = await checkList("finance-invoice-metadata-redacted", "SIM-OOH-invoice-1", 200);
  assert.equal(metadata.documents.length, 2);
  assert.equal(metadata.hasMore, false);
  assert.deepEqual(metadata.documents.map(row => row.id).sort(), ["SIM-OOH-document-1", "SIM-OOH-document-3"]);
  documents.push({ ...documents[0], id: "SIM-OOH-wrong-parent-campaign", fileName: "SIM-OOH-PRIVATE-WRONG-CAMPAIGN.pdf", campaignId: "SIM-OOH-campaign-2" });
  documents.push({ ...documents[0], id: "SIM-OOH-wrong-parent-client", fileName: "SIM-OOH-PRIVATE-WRONG-CLIENT.pdf", clientId: "SIM-OOH-client-2" });
  documents.push({ ...documents[0], id: "SIM-OOH-operational-proof", fileName: "SIM-OOH-PRIVATE-OPERATIONAL-PROOF.jpg", documentType: "operational_proof_photo" });
  const cleaned = await checkList("legacy-wrong-parent-and-operational-metadata-excluded", "SIM-OOH-invoice-1", 200);
  assert.deepEqual(cleaned.documents.map(row => row.id).sort(), ["SIM-OOH-document-1", "SIM-OOH-document-3"]);
  assert.ok(!JSON.stringify(cleaned).includes("SIM-OOH-PRIVATE"), "A legacy inconsistent document or operational proof leaked metadata.");
  await checkList("missing-invoice-metadata-denied", "SIM-OOH-missing-invoice", 404);
  actor.role = "FIELD_OPERATOR";
  await checkList("non-finance-metadata-permission-denied", "SIM-OOH-invoice-1", 403);
  actor.role = "FINANCE_OPERATOR";
  for (let index = 0; index < 102; index++) {
    documents.push({ ...documents[0], id: `SIM-OOH-cap-${String(index).padStart(3, "0")}`, uploadedAt: new Date(Date.UTC(2090, 0, index + 1)), notes: "SIM-OOH private note" });
  }
  const capped = await checkList("invoice-metadata-cap-is-explicit", "SIM-OOH-invoice-1", 200);
  assert.equal(capped.documents.length, 100);
  assert.equal(capped.hasMore, true);
  assert.equal(capped.documents[0].id, "SIM-OOH-cap-101");
  assert.equal(documentQueries.at(-1).take, 101, "Read only one overflow metadata row beyond the visible cap.");
  console.log(JSON.stringify({ ok: true, checks, databaseConnections: 0, networkRequests: 0, externalStorageWrites: 0, inMemoryDocuments: documents.length }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
