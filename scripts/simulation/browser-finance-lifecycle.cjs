"use strict";

// Called by the gated browser lifecycle harness. All mutations originate from
// visible application controls; responses are observed, never replayed directly.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generateInvoiceFile, generateFiscalEvidenceFile } = require("./lifecycle-fixtures.cjs");

function unsupported(message) {
  const error = new Error(message);
  error.unsupported = true;
  throw error;
}

function moneyCents(value) {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("SYNTHETIC_FINANCE_EXPECTED_EXACT_AMOUNT");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function moneyString(value) {
  return (value / 100n).toString() + "." + (value % 100n).toString().padStart(2, "0");
}

function checkState(state) {
  if (!state.booked || !state.clientId || !state.campaignId || !String(state.company || "").startsWith("SIM-OOH") || !/^SIM[A-Z0-9]+$/i.test(String(state.taxId || "")) || !["EUR", "RON"].includes(state.currency)) unsupported("The same synthetic company and its BOOKED rental are required before following billing and cash.");
}

function checkpoint(ui, state) {
  if (typeof ui.persistLifecycleState === "function") ui.persistLifecycleState();
  else throw new Error("SYNTHETIC_FINANCE_DURABLE_STATE_CALLBACK_REQUIRED");
}

function assertLinkedPlan(plan, state) {
  assert.equal(plan.total, state.invoiceRecords.length, "The linked billing plan changed its invoice count.");
  for (const record of state.invoiceRecords) {
    const item = plan.items.find(row => row.id === record.billingItemId);
    assert.ok(item, "An imported invoice lost its contractual billing position.");
    assert.equal(moneyCents(item.amount), moneyCents(record.netAmount));
    assert.equal(moneyCents(item.linkedAmount), moneyCents(record.netAmount));
    assert.equal(moneyCents(item.unlinkedAmount), 0n);
    assert.ok(item.invoiceReferences.some(ref => ref.id === record.receivableId && ref.number === record.invoiceNumber), "The billing position does not reference its exact imported invoice.");
  }
}

async function linkedPlanFollowup(ui, page, state, replay = false) {
  const plans = observePlans(page, state);
  try {
    await ui.goto(page, "/admin/financiar/facturi-de-emis", "Check the billing plan after invoice allocation");
    await ui.settle(page); await chooseCampaign(ui, page, state);
    const plan = await waitUntil(() => plans.values.findLast(value => value.items?.length), "The linked billing plan was not observed after selecting the campaign.");
    assertLinkedPlan(plan, state);
    ui.observe("Billing plan retains every exact imported invoice", { positions: plan.items, replay }, "Each contractual position references its own imported invoice; allocated net equals planned net and no unallocated balance remains.");
    await ui.capture(page, "lifecycle-billing-plan-linked-invoices", [1440, 390]);
  } finally { plans.detach(); }
}

async function attachInvoiceEvidence(ui, page, state, verifyExisting = false) {
  if (verifyExisting && !state.invoiceRecords.every(row => row.documentId)) unsupported("An invoice original is missing; a read-only resume cannot invent an attachment.");
  if (!verifyExisting && state.invoiceRecords.every(row => row.documentId && row.documentDownloadedByFinance)) return;
  await ui.goto(page, "/admin/financiar/alocari", "Finance attaches the fictional originals directly to their imported invoice records");
  await ui.settle(page);
  await chooseCampaign(ui, page, state);
  for (const record of state.invoiceRecords) {
    if (!verifyExisting && record.documentId && record.documentDownloadedByFinance) continue;
    await ui.fill(page.getByLabel("Caută factura fiscală importată", { exact: true }), record.invoiceNumber, "invoice_number", true);
    await ui.select(page.getByLabel(/^factura fiscală importată/), record.receivableId, "Choose the imported invoice that owns this original PDF");
    if (!record.documentId) {
      await ui.click(page.getByRole("button", { name: "Atașează document facturii", exact: true }), "Finance uploads one clearly fictional invoice PDF to its invoice");
      ui.surface("Financial invoice original upload");
      const dialog = page.getByRole("dialog", { name: "Incarca document", exact: true });
      await ui.select(dialog.getByLabel(/^Tip document/), "other", "Use the available general document category for invoice evidence");
      await ui.act("file_uploads", "Choose fictional invoice evidence PDF", () => dialog.getByLabel("Fisier", { exact: true }).setInputFiles(record.syntheticFiscalEvidence.path));
      await ui.fill(dialog.getByLabel("Observatii", { exact: true }), `SIM-OOH fictional invoice ${record.invoiceNumber}; same synthetic client ${state.clientId}; intended campaign allocation ${state.campaignId}. This is synthetic evidence, not real fiscal issuance.`, "invoice_document_note");
      const uploaded = await ui.responseAfter(page, response => new URL(response.url()).pathname === "/api/admin/client-documents" && response.request().method() === "POST", () => ui.click(dialog.getByRole("button", { name: "Salveaza", exact: true }), "Save the invoice-linked original using finance permissions"));
      assert.ok(uploaded.document?.id, "The synthetic invoice PDF upload did not return a document ID.");
      record.documentId = uploaded.document.id;
      checkpoint(ui, state);
    }
    const evidence = page.getByRole("region", { name: "Documentele facturii selectate", exact: true }).locator("article").filter({ hasText: path.basename(record.syntheticFiscalEvidence.path) });
    await evidence.waitFor();
    const downloaded = page.waitForEvent("download");
    await ui.click(evidence.getByRole("link", { name: "Deschide", exact: true }), "Finance reopens the protected original attached to this exact invoice");
    const file = await downloaded;
    assert.equal(file.suggestedFilename(), path.basename(record.syntheticFiscalEvidence.path));
    assert.equal(await file.failure(), null, "The original PDF download did not complete.");
    assert.ok(fs.readFileSync(await file.path()).equals(fs.readFileSync(record.syntheticFiscalEvidence.path)), "The downloaded invoice evidence differs from its uploaded original.");
    record.documentDownloadedByFinance = true;
    checkpoint(ui, state);
  }
  ui.observe("Finance retains and reopens each exact invoice original", { intendedCampaignId: state.campaignId, clientId: state.clientId, documents: state.invoiceRecords.map(row => ({ invoiceNumber: row.invoiceNumber, receivableId: row.receivableId, documentId: row.documentId, fileName: path.basename(row.syntheticFiscalEvidence.path), downloadedByFinance: row.documentDownloadedByFinance })), attachment_context: "authoritative imported invoice", attachment_actor_role: "finance", campaign_value_allocation_is_a_separate_explicit_step: true }, "The finance operator uploads and downloads the original PDF through the selected invoice. Existing ownership/link checks remain in force; attaching an original does not invent a campaign allocation or issue a fiscal document.");
  await ui.capture(page, "lifecycle-invoice-evidence-attached", [1440, 390]);
}

async function chooseCampaign(ui, page, state) {
  await ui.fill(page.getByLabel("Caută campania", { exact: true }), state.campaignName || state.company, "campaign_name", true);
  await ui.select(page.getByLabel(/^campania/), state.campaignId, "Choose the same booked campaign from search results");
  await ui.select(page.getByLabel(/^Monedă/), state.currency, "Select the verified campaign currency for finance");
  await ui.settle(page);
}

function observePlans(page, state) {
  const values = [];
  const listener = async response => {
    try {
      const url = new URL(response.url());
      if (url.pathname !== "/api/admin/billing-plan" || response.request().method() !== "GET" || url.searchParams.get("campaignId") !== state.campaignId || url.searchParams.get("currency") !== state.currency || response.status() !== 200) return;
      const data = await response.json();
      values.push(data);
    } catch { /* A navigation can discard an already superseded response. */ }
  };
  page.on("response", listener);
  return { values, detach: () => page.off("response", listener) };
}

async function waitUntil(predicate, message, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = await predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function uniqueImportRows(preview) {
  const rows = Object.values(preview?.groups || {}).flat();
  return [...new Map(rows.map(row => [row.id, row])).values()];
}

async function resolveImportConfirmation(ui, page, state, preview) {
  // Matching an exact newly created synthetic tax ID normally produces a safe
  // auto-allocation. If review is required, perform it explicitly in the UI.
  for (let index = 0; index < 15; index++) {
    if (preview?.groups?.conflict?.length) unsupported("The staged synthetic invoice has an explicit import conflict. No conflict was auto-overridden.");
    if (preview?.groups?.manual?.length) unsupported("The invoice needs detailed manual matching rather than the expected exact CUI identity. Review is required; no client was guessed.");
    const row = preview?.groups?.needs_confirmation?.[0];
    if (!row) return preview;
    await ui.click(page.getByRole("button", { name: /^Necesită confirmare/ }).first(), "Review the invoice match awaiting explicit confirmation");
    const tableRow = page.getByRole("row").filter({ hasText: row.rawInvoiceNumber });
    await ui.click(tableRow.getByRole("button", { name: "Confirmă", exact: true }), "Confirm the exact synthetic client/invoice match");
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Confirmă alocarea", exact: true }) });
    await ui.select(dialog.getByLabel(/^Client canonic/), state.clientId, "Choose the same synthetic canonical client");
    await ui.fill(dialog.getByLabel("Observație", { exact: true }), "SIM-OOH exact CUI/name verified against the newly prepared fictional dossier.", "invoice_match_evidence");
    const resolved = await ui.responseAfter(page, response => response.request().method() === "PATCH" && response.url().includes("/api/admin/receivables-import/") && response.url().includes("/rows/"), () => ui.click(dialog.getByRole("button", { name: "Confirmă alocarea", exact: true }), "Save reviewed invoice matching"));
    preview = resolved.preview;
  }
  unsupported("Import review exceeded the bounded number of synthetic rows.");
}

async function billingInvoices(ui, state) {
  checkState(state);
  if (!Number.isInteger(state.vatRateBps) || state.vatRateBps < 0 || state.vatRateBps > 10000) throw new Error("SYNTHETIC_LIFECYCLE_EXPLICIT_VERIFIED_VAT_BASIS_REQUIRED");
  const { page } = await ui.authenticated("finance");
  if (state.billingInvoicesCompleted) {
    await attachInvoiceEvidence(ui, page, state, true);
    await linkedPlanFollowup(ui, page, state, true);
    return state;
  }
  const planned = observePlans(page, state);
  try {
    await ui.goto(page, "/admin/financiar/facturi-de-emis", "Finance opens internal invoices-to-issue planning");
    await ui.settle(page);
    await chooseCampaign(ui, page, state);
    const generated = await ui.responseAfter(page, response => new URL(response.url()).pathname === "/api/admin/billing-plan" && response.request().method() === "POST", () => ui.click(page.getByRole("button", { name: "Generează / reconciliază planul campaniei", exact: true }), "Generate the same campaign's contractual billing positions"));
    assert.equal(generated.fiscalIssuance, false, "Internal plan generation must not represent fiscal issuance.");
    const plan = await waitUntil(() => planned.values.findLast(value => value.items?.length && value.items.every(item => item.campaignId === state.campaignId)), "The generated campaign billing plan was not observed in the UI response.");
    if (plan.totalPages > 1) unsupported("The new single-campaign scenario unexpectedly exceeds one page of billing positions; no invoices were generated for an incomplete plan.");
    assert.equal(plan.items.length, plan.total);
    assert.ok(plan.items.every(item => item.currency === state.currency && item.clientId === state.clientId), "Billing items changed client or currency during the commercial handoff.");
    assert.ok(plan.items.every(item => item.isFiscalInvoice === false && item.companyEntity === state.companyEntity), "Billing plan changed the issuer or represented a fiscal invoice.");
    state.billingItems = plan.items;
    checkpoint(ui, state);
    ui.observe("BOOKED rental becomes an internal billing plan", { generated, positions: plan.items.map(item => ({ id: item.id, locationCode: item.locationCode, periodStart: item.periodStart, periodEnd: item.periodEnd, invoiceDate: item.invoiceDate, dueDate: item.dueDate, net: item.amount, currency: item.currency, clientId: item.clientId, campaignId: item.campaignId, isFiscalInvoice: item.isFiscalInvoice })) }, "Exact agreed price periods, client, legal entity, currency and due dates transfer into a plan; no fiscal document is issued.");
    await ui.capture(page, "lifecycle-internal-billing-plan", [1440, 390]);
  } finally { planned.detach(); }

  const entityCodes = { "Focus Media": "FOCUS_MEDIA", "Excellence Media": "EXCELLENCE_MEDIA", "Focus BG / Focus Media LLC EOOD": "FOCUS_BG" };
  const companyCode = state.companyCode || entityCodes[state.companyEntity];
  if (!companyCode) throw new Error("SYNTHETIC_LIFECYCLE_ISSUER_CONFIGURATION_REQUIRED");
  const suffix = state.campaignId.replace(/[^a-z0-9]/gi, "").slice(-12).toUpperCase();
  const ledger = state.invoiceLedger || generateInvoiceFile({
    companyName: state.company, taxId: state.taxId, companyCode, currency: state.currency,
    vatRateBps: state.vatRateBps, fileStem: `SIM-OOH-LIFECYCLE-${suffix}`,
    rows: state.billingItems.map((item, index) => ({
      invoiceNumber: `SIM-OOH-LIFE-${suffix}-${String(index + 1).padStart(2, "0")}`,
      netAmount: item.amount, invoiceDate: item.invoiceDate, dueDate: item.dueDate,
      locationCode: item.locationCode, campaignName: item.campaign,
      billingItemId: item.id, periodStart: item.periodStart, periodEnd: item.periodEnd,
    })),
  }, state.filesDir || path.join("/workspace/work/ooh-simulation", "lifecycle-files"));
  state.invoiceLedger = { path: ledger.path, evidencePath: ledger.evidencePath };
  state.invoiceRecords ||= ledger.rows.map(row => ({ ...row }));
  for (const record of state.invoiceRecords) {
    record.syntheticFiscalEvidence ||= generateFiscalEvidenceFile({ ...record, companyName: state.company, taxId: state.taxId }, state.filesDir || path.dirname(ledger.path));
  }
  checkpoint(ui, state);

  if (!state.invoiceRecords.every(row => row.receivableId)) {
    assert.ok(state.invoiceRecords.every(row => !row.receivableId), "A partial imported state requires an explicit UI review before continuing.");
    await ui.goto(page, "/admin/financiar/incasari", "Record the synthetic externally-issued invoices through the supported import UI");
    await ui.settle(page);
    let preview;
    if (state.invoiceImportId) {
      await ui.click(page.getByRole("navigation", { name: "Secțiuni facturi clienți", exact: true }).getByRole("button", { name: "Istoric importuri", exact: true }), "Reopen the previously staged synthetic invoice import");
      const resumed = await ui.responseAfter(page, response => new URL(response.url()).pathname === `/api/admin/receivables-import/${state.invoiceImportId}` && response.request().method() === "GET", () => ui.click(page.getByRole("button", { name: path.basename(ledger.path), exact: true }), "Resume the exact previously staged invoice file"));
      preview = resumed.preview;
    } else {
      await ui.click(page.getByRole("navigation", { name: "Secțiuni facturi clienți", exact: true }).getByRole("button", { name: "Import nou", exact: true }), "Open invoice report import");
      const importForm = page.locator("form").filter({ has: page.locator('input[type="file"][name="file"]') });
      await ui.select(importForm.getByLabel(/^Firmă/), companyCode, "Choose the same contracting legal entity as invoice issuer");
      await ui.fill(importForm.getByLabel("Data raportului", { exact: true }), new Date().toISOString().slice(0, 10), "invoice_report_date");
      await ui.act("file_uploads", "Select fictional external invoice ledger XLSX", () => importForm.getByLabel("Fișier Excel", { exact: true }).setInputFiles(ledger.path));
      const staged = await ui.responseAfter(page, response => new URL(response.url()).pathname === "/api/admin/receivables-import" && response.request().method() === "POST", () => ui.click(importForm.getByRole("button", { name: "Analizează raportul", exact: true }), "Analyze the fictional invoice ledger without committing invoice rows"));
      state.invoiceImportId = staged.preview?.upload?.id || staged.upload?.id;
      assert.ok(state.invoiceImportId, "The staged invoice import did not return an upload ID.");
      checkpoint(ui, state);
      preview = staged.preview;
    }
    preview = await resolveImportConfirmation(ui, page, state, preview);
    const stagedRows = uniqueImportRows(preview);
    assert.equal(stagedRows.length, state.invoiceRecords.length, "The import preview lost or duplicated a planned invoice.");
    assert.ok(stagedRows.every(row => row.clientId === state.clientId && row.currency === state.currency), "Invoice import proposed another client or currency.");
    ui.observe("Invoice import requires an explicit accounting handoff", { fictional_ledger: ledger.path, preview_rows: stagedRows.map(row => ({ invoiceNumber: row.rawInvoiceNumber, clientId: row.clientId, currency: row.currency, gross: row.invoiceAmount, status: row.status })), fiscal_issuance: false }, "The app imports an externally issued invoice record. Internal plan generation alone must not be treated as fiscal issuance.");
    await ui.capture(page, "lifecycle-invoice-import-preview", [1440, 390]);
    if (preview.upload.status !== "confirmed") {
      await ui.click(page.getByRole("button", { name: "Confirmă importul", exact: true }), "Review committing the validated synthetic invoice rows");
      const confirmDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Confirmă importul", exact: true }) });
      const confirmed = await ui.responseAfter(page, response => response.url().includes("/api/admin/receivables-import/") && response.url().endsWith("/confirm") && response.request().method() === "POST", () => ui.click(confirmDialog.getByRole("button", { name: "Confirmă importul tranzacțional", exact: true }), "Commit the reviewed local invoice import"));
      preview = confirmed.preview;
    }
    const importedRows = uniqueImportRows(preview);
    for (const record of state.invoiceRecords) {
      const row = importedRows.find(item => item.rawInvoiceNumber === record.invoiceNumber);
      assert.ok(row?.receivableId, "A committed invoice did not expose its resulting local record ID.");
      assert.equal(row.clientId, state.clientId);
      record.receivableId = row.receivableId;
    }
    checkpoint(ui, state);
  }

  await attachInvoiceEvidence(ui, page, state);

  await ui.goto(page, "/admin/financiar/alocari", "Link verified synthetic invoices to the campaign and billing positions");
  await ui.settle(page);
  await chooseCampaign(ui, page, state);
  const taxForm = page.locator("form").filter({ has: page.getByRole("heading", { name: "Verifică defalcarea fiscală lipsă", exact: true }) });
  const allocationForm = page.locator("form").filter({ has: page.getByRole("heading", { name: "Asociază valoarea fiscală unei campanii", exact: true }) });
  if (!(await taxForm.count()) || !(await allocationForm.count())) unsupported("The authenticated finance role cannot verify fiscal breakdown and allocate imported invoices in the available UI.");
  for (const record of state.invoiceRecords) {
    if (record.allocationId) continue;
    if (!record.taxAttested) {
      await ui.fill(taxForm.getByLabel("Caută documentul fiscal sau stornarea", { exact: true }), record.invoiceNumber, "invoice_number", true);
      await ui.select(taxForm.getByLabel(/^documentul fiscal sau stornarea/), record.receivableId, "Select the imported fictional invoice for explicit tax verification");
      await ui.fill(taxForm.getByLabel("Net fiscal original", { exact: true }), record.netAmount, "invoice_net");
      await ui.fill(taxForm.getByLabel("TVA original", { exact: true }), record.vatAmount, "invoice_vat");
      await ui.fill(taxForm.getByLabel("Referință document verificat", { exact: true }), `SIM-OOH verified fictional evidence ${record.invoiceNumber}; local PDF ${record.syntheticFiscalEvidence.reference}`, "fiscal_evidence_reference");
      await ui.responseAfter(page, response => response.request().method() === "POST" && response.url().includes("/api/admin/financial/campaign-finance") && response.request().postDataJSON()?.action === "attest_tax", () => ui.click(taxForm.getByRole("button", { name: "Confirmă verificarea fiscală", exact: true }), "Record explicit net and VAT from the fictional invoice evidence"));
      record.taxAttested = true;
      checkpoint(ui, state);
    }
    await ui.fill(page.getByLabel("Caută factura fiscală importată", { exact: true }), record.invoiceNumber, "invoice_number", true);
    await ui.select(page.getByLabel(/^factura fiscală importată/), record.receivableId, "Choose the same verified invoice for campaign allocation");
    await ui.fill(allocationForm.getByLabel("Net", { exact: true }), record.netAmount, "invoice_net");
    await ui.fill(allocationForm.getByLabel("TVA", { exact: true }), record.vatAmount, "invoice_vat");
    await ui.fill(allocationForm.getByLabel("Brut", { exact: true }), record.grossAmount, "invoice_gross");
    await ui.select(allocationForm.getByLabel(/^Poziția contractuală din plan/), record.billingItemId, "Associate the exact contractual billing position");
    await ui.fill(allocationForm.getByLabel("Notă", { exact: true }), `SIM-OOH same campaign/client/entity/currency; synthetic invoice ${record.invoiceNumber}`, "allocation_evidence_note");
    const allocated = await ui.responseAfter(page, response => response.request().method() === "POST" && response.url().includes("/api/admin/financial/campaign-finance") && response.request().postDataJSON()?.action === "allocate", () => ui.click(allocationForm.getByRole("button", { name: "Înregistrează alocarea", exact: true }), "Commit the explicit net/VAT/gross campaign allocation"));
    record.allocationId = allocated.id || allocated.allocation?.id || null;
    assert.ok(record.allocationId, "The allocation did not return a durable reference.");
    checkpoint(ui, state);
  }
  state.billingInvoicesCompleted = true;
  ui.observe("Same client and campaign retain explicit invoice allocation", { clientId: state.clientId, campaignId: state.campaignId, invoices: state.invoiceRecords.map(row => ({ invoiceNumber: row.invoiceNumber, receivableId: row.receivableId, billingItemId: row.billingItemId, allocationId: row.allocationId, net: row.netAmount, vat: row.vatAmount, gross: row.grossAmount, currency: row.currency })), invoice_net_and_vat_were_entered_twice: true }, "Every invoice is linked to the correct contractual position. The current workflow requires net/VAT reentry for attestation and allocation, which should be counted as manual work.");
  await ui.capture(page, "lifecycle-explicit-financial-allocation", [1440, 390]);
  checkpoint(ui, state);
  await linkedPlanFollowup(ui, page, state);
  return state;
}

async function receiptFollowup(ui, state) {
  checkState(state);
  if (!state.billingInvoicesCompleted || !state.invoiceRecords?.[0]?.receivableId) unsupported("No successfully imported and allocated invoice is available for a truthful receipt follow-up.");
  const record = state.invoiceRecords[0];
  const grossCents = moneyCents(record.grossAmount);
  const paidCents = state.receiptAmount ? moneyCents(state.receiptAmount) : grossCents / 2n;
  if (paidCents <= 0n || paidCents > grossCents) throw new Error("SYNTHETIC_LIFECYCLE_RECEIPT_MUST_NOT_OVERPAY");
  const paid = moneyString(paidCents), remaining = moneyString(grossCents - paidCents);
  const { page } = await ui.authenticated("finance");
  await ui.goto(page, "/admin/financiar/incasari", "Follow payment of the same imported synthetic invoice"); await ui.settle(page);
  await ui.fill(page.getByLabel("Caută", { exact: true }), record.invoiceNumber, "invoice_number", true);
  const searched = await ui.responseAfter(page, response => new URL(response.url()).pathname === "/api/admin/receivables-workspace/registry" && response.request().method() === "GET", () => ui.click(page.getByRole("button", { name: "Aplică", exact: true }), "Find the imported unpaid invoice in the active cash ledger"));
  const before = searched.registry?.items?.find(row => row.id === record.receivableId);
  assert.ok(before && before.clientId === state.clientId && before.currency === state.currency, "The same imported invoice was not available under the expected client and currency.");
  if (!state.receipt) {
    assert.equal(moneyCents(before.collectedAmount), 0n, "The newly imported invoice already has a receipt; review is required before another payment.");
    assert.equal(moneyCents(before.remainingAmount), grossCents);
    const row = page.getByRole("row").filter({ hasText: record.invoiceNumber });
    await row.waitFor();
    await ui.click(row.getByRole("button", { name: "Înregistrează plată", exact: true }), "Record a local synthetic bank-transfer receipt");
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Înregistrează încasare", exact: true }) });
    await ui.fill(dialog.getByLabel("Suma plătită", { exact: true }), paid, "receipt_amount");
    const receiptDate = state.simulatedReceiptDate || record.invoiceDate.slice(0, 10);
    await ui.fill(dialog.getByLabel("Data încasării", { exact: true }), receiptDate, "receipt_date");
    await ui.select(dialog.getByLabel(/^Metoda de plată/), "transfer_bancar", "Choose a local ledger transfer reference, without any bank operation");
    await ui.fill(dialog.getByLabel("Referință operațiune", { exact: true }), `SIM-OOH-NO-REAL-BANK-${record.invoiceNumber}`, "receipt_reference");
    await ui.fill(dialog.getByLabel("Observații", { exact: true }), "SIM-OOH fictional receipt for isolated workflow verification; no real money or bank transfer.", "receipt_note");
    const result = await ui.responseAfter(page, response => response.url().includes(`/api/admin/receivables/${record.receivableId}/payments`) && response.request().method() === "POST", () => ui.click(dialog.getByRole("button", { name: "Salvează plata", exact: true }), "Save the single synthetic receipt and recalculate the active balance"));
    state.receipt = { invoiceNumber: record.invoiceNumber, receivableId: record.receivableId, amount: paid, currency: state.currency, expectedRemaining: remaining, receivedAt: receiptDate, result, realBankOperation: false };
    checkpoint(ui, state);
    assert.equal(result.duplicate, false, "The first observed synthetic receipt unexpectedly replayed an earlier payment.");
    assert.equal(result.receivable?.id, record.receivableId);
    assert.equal(moneyCents(result.receivable.collectedAmount), paidCents);
    assert.equal(moneyCents(result.receivable.remainingAmount), grossCents - paidCents);
    assert.equal(result.payment?.receivableId, record.receivableId);
    assert.equal(moneyCents(result.payment.amount), paidCents);
  } else {
    assert.equal(state.receipt.receivableId, record.receivableId);
    assert.equal(moneyCents(before.collectedAmount), paidCents);
    assert.equal(moneyCents(before.remainingAmount), grossCents - paidCents);
    ui.observe("Resume the already saved receipt", { paymentId: state.receipt.result?.payment?.id, receivableId: record.receivableId, collectedAmount: before.collectedAmount, remainingAmount: before.remainingAmount }, "A retry verifies the saved cash ledger and does not enter a second receipt.");
  }
  ui.observe("Local receipt is an append-only ledger entry", state.receipt, "Exactly one receipt updates the invoice balance and history; there is no external bank transfer and no overwriting of previous cash history.");
  await ui.capture(page, "lifecycle-partial-receipt-balance", [1440, 390]);
  const history = await ui.responseAfter(page, response => new URL(response.url()).pathname === "/api/admin/receivables-workspace/payments" && response.request().method() === "GET", () => ui.click(page.getByRole("navigation", { name: "Secțiuni facturi clienți", exact: true }).getByRole("button", { name: "Istoric încasări", exact: true }), "Check the recorded receipt in history"));
  if (history.data?.pagination?.totalPages !== 1) unsupported("Receipt history spans multiple pages; the available first page cannot prove global receipt uniqueness.");
  const payments = history.data?.items?.filter(row => row.receivableId === record.receivableId && row.status === "active");
  assert.equal(payments?.length, 1, "Receipt history did not show exactly one active receipt for the synthetic invoice.");
  assert.equal(payments[0].id, state.receipt.result.payment.id);
  assert.equal(moneyCents(payments[0].amount), paidCents);
  assert.equal(payments[0].currency, state.currency);
  assert.equal(payments[0].paymentReference, `SIM-OOH-NO-REAL-BANK-${record.invoiceNumber}`);
  assert.ok(payments[0].createdBy?.name, "Receipt history lost the responsible operator.");
  await page.getByRole("table").filter({ hasText: record.invoiceNumber }).waitFor();
  ui.observe("Receipt history keeps invoice, amount, operator and source", { invoiceNumber: record.invoiceNumber, visible_history: (await page.locator("body").innerText()).slice(-9000) }, "The same synthetic receipt is visible with its invoice, date, amount, state and responsible user.");
  await ui.capture(page, "lifecycle-receipt-history", [1440, 390]);
  await ui.goto(page, `/admin/campanii?campaignId=${encodeURIComponent(state.campaignId)}`, "Seller and management follow the same campaign's financial outcome"); await ui.settle(page);
  const campaign = await ui.responseAfter(page, response => new URL(response.url()).pathname === `/api/admin/campaigns/${state.campaignId}/finance` && response.request().method() === "GET", () => ui.click(page.getByRole("tab", { name: "Financiar", exact: true }), "Read campaign revenue allocation and attributable cash balance"));
  const totalGross = state.invoiceRecords.reduce((sum, item) => sum + moneyCents(item.grossAmount), 0n);
  const suffix = state.currency === "EUR" ? "Eur" : "Ron";
  assert.equal(moneyCents(campaign.finance[`invoiced${suffix}`]), totalGross);
  assert.equal(moneyCents(campaign.finance[`collected${suffix}`]), paidCents);
  assert.equal(moneyCents(campaign.finance[`remaining${suffix}`]), totalGross - paidCents);
  assert.deepEqual(campaign.finance.dataQualityReasons, [], "The fully allocated fictional invoices still have unexplained finance warnings.");
  ui.observe("Campaign financial tracking after receipt", { expected_clientId: state.clientId, expected_campaignId: state.campaignId, currency: state.currency, invoiceGross: moneyString(totalGross), expectedCash: paid, expectedRemaining: moneyString(totalGross - paidCents), observedSummary: campaign.finance }, "Campaign finance reports the exact invoice gross, received amount and attributable remaining balance, retaining separate currencies.");
  await ui.capture(page, "lifecycle-campaign-finance-after-receipt", [1440, 390]);
  state.receiptFollowupCompleted = true;
  checkpoint(ui, state);
  return state;
}

module.exports = { billingInvoices, receiptFollowup };
