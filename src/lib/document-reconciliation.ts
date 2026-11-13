import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthSession } from "@/lib/auth";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { normalizeReceivableInvoiceNumber } from "@/lib/receivables-domain";
import { canonicalTaxId } from "@/lib/tax-id";
import { companyCodeForEntity } from "@/lib/company-entities";
import { assertDocumentAuditWriter } from "@/lib/document-source-service";
import { canonicalDocumentValue, documentFactSchema, documentHash, DocumentAuditError, mayManageDocumentAudit, type DocumentFact } from "@/lib/document-source-domain";
import { isEffectiveBlockingReservation } from "@/lib/reservation-lifecycle-domain";

type Tx = Prisma.TransactionClient;
export type DocumentAuditFinding = {
  code: string; severity: "difference" | "review"; title: string;
  documentId: string; documentVersionId: string; sourceSha256: string;
  targetType?: "reservation" | "receivable"; targetId?: string; locationCode?: string;
  current?: Record<string, string | null>; proposed?: Record<string, string | null>;
  evidence?: { page: number; quote: string }; href?: string;
};
const day = (value: Date) => value.toISOString().slice(0, 10);
const cents = (value: Prisma.Decimal.Value | null | undefined) => value == null ? null : new Prisma.Decimal(value).toFixed(2);
const contractKey = (value: string | null | undefined) => String(value || "").trim().toLocaleUpperCase("ro-RO").replace(/\s+/g, " ");
const invoiceCompany = (value: string | null | undefined) => ["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"].includes(value || "") ? value! : companyCodeForEntity(value);

/** Only explicit, human-verified facts are compared. There is deliberately no
 * PDF interpretation, business mutation, invoice issuance or payment inference. */
export async function runDocumentReconciliation(actor: AuthSession, context: { trigger?: "manual" | "scheduled"; delegatedSourceId?: string } = {}) {
  const asOf = new Date();
  return prisma.$transaction(async (tx) => {
    const current = await assertDocumentAuditWriter(tx, actor);
    // Cron requests serialize on the delegated owner row. Reuse a recent
    // snapshot rather than creating duplicate reports after scheduler retries.
    if (context.trigger === "scheduled") {
      const delegated = context.delegatedSourceId ? await tx.documentAuditSource.findFirst({ where: { id: context.delegatedSourceId, state: "active", ownerUserId: current.id, ownerTokenVersion: current.tokenVersion, ingestTokenHash: { not: null } }, select: { id: true } }) : null;
      if (!delegated) throw new DocumentAuditError("Delegația sursei a fost revocată.", 403, "DOCUMENT_SOURCE_DELEGATION_REVOKED");
      const recent = await tx.documentAuditRun.findFirst({ where: { createdAt: { gte: new Date(asOf.getTime() - 300000) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      if (recent && Array.isArray(recent.findings) && Array.isArray(recent.limitations)) return { id: recent.id, asOf: recent.asOf.toISOString(), scopeComplete: recent.scopeComplete, counts: recent.counts, findings: recent.findings as DocumentAuditFinding[], limitations: recent.limitations as string[], sourceSnapshotHash: recent.sourceSnapshotHash, businessRowsModified: 0, reusedRecentSnapshot: true };
    }
    const sources = await tx.documentAuditSource.findMany({ where: { state: "active" }, orderBy: { id: "asc" }, select: { id: true, lastCompletedScanAt: true, lastIngestAt: true, maxStaleHours: true, version: true } });
    const sourceIds = sources.map((source) => source.id);
    const counts = { sources: sources.length, documents: 0, missingFiles: 0, pendingReview: 0, rejectedReviews: 0, verifiedDocuments: 0, factsCompared: 0, reservationsCompared: 0, invoicesCompared: 0, differences: 0, needsReview: 0, findingsStored: 0 };
    const findings: DocumentAuditFinding[] = [], evidenceKeys: string[] = [];
    const locationEvidence = new Map<string, Array<{ signature: string; periodStart: string; periodEnd: string }>>();
    const add = (finding: DocumentAuditFinding) => { if (finding.severity === "difference") counts.differences++; else counts.needsReview++; if (findings.length < 200) findings.push(finding); };
    const limitations = [
      "Auditul acoperă numai fișierele din sursele active și faptele confirmate explicit din versiunea curentă; nu dovedește inventarierea tuturor contractelor companiei.",
      "Anexele, actele adiționale și documentele care se contrazic cer stabilirea de către un om a versiunii comerciale valabile.",
      "O factură nu dovedește încasarea. Nu sunt modificate și nu sunt deduse plăți, credite, rezervări sau prețuri.",
      "Sumele de contract sunt comparate numai ca chirie lunară explicită pe cod, în aceeași monedă; totalul contractului nu este împărțit automat.",
    ];
    let scopeComplete = sources.length > 0;
    if (!sources.length) limitations.push("Nicio sursă NAS activă configurată: datele reale nu au putut fi auditate.");
    for (const source of sources) {
      evidenceKeys.push(canonicalDocumentValue(source));
      if (!source.lastCompletedScanAt || asOf.getTime() - source.lastCompletedScanAt.getTime() > source.maxStaleHours * 3600000) { scopeComplete = false; limitations.push("Există o sursă fără scanare completă recentă; raportul trebuie actualizat după sincronizare."); }
    }
    let cursor: string | undefined, factLimitReached = false;
    while (sourceIds.length) {
      const documents = await tx.sourceDocument.findMany({ where: { sourceId: { in: sourceIds }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 100 });
      if (!documents.length) break;
      const versions = await tx.sourceDocumentVersion.findMany({ where: { id: { in: documents.map((doc) => doc.currentVersionId).filter((id): id is string => Boolean(id)) } }, include: { reviews: { orderBy: { version: "desc" }, take: 1 } } });
      const byId = new Map(versions.map((version) => [version.id, version]));
      for (const document of documents) {
        counts.documents++;
        const version = document.currentVersionId ? byId.get(document.currentVersionId) : null;
        if (!version || version.documentId !== document.id) { counts.pendingReview++; scopeComplete = false; continue; }
        const base = { documentId: document.id, documentVersionId: version.id, sourceSha256: version.sha256 };
        evidenceKeys.push(`${document.id}:${document.state}:${version.id}:${version.sha256}:${version.reviewVersion}`);
        if (document.state !== "present") {
          counts.missingFiles++; scopeComplete = false;
          add({ ...base, severity: "review", code: "SOURCE_FILE_NOT_SEEN", title: "Fișierul nu a fost observat în ultima scanare completă; istoricul este păstrat." }); continue;
        }
        const review = version.reviews[0];
        if (!review || review.version !== version.reviewVersion || review.state !== "verified") {
          if (review?.state === "rejected") counts.rejectedReviews++; else counts.pendingReview++;
          scopeComplete = false;
          add({ ...base, severity: "review", code: version.extractionStatus === "needs_ocr" ? "OCR_REVIEW_REQUIRED" : "DOCUMENT_FACTS_UNVERIFIED", title: version.extractionStatus === "needs_ocr" ? "PDF scanat: este necesar OCR sau verificarea originalului." : "Faptele documentului nu sunt confirmate din original." }); continue;
        }
        const factValues = Array.isArray(review.facts) ? review.facts : [];
        const facts: DocumentFact[] = [];
        for (const value of factValues) { const parsed = documentFactSchema.safeParse(value); if (parsed.success) facts.push(parsed.data); }
        if (!facts.length || facts.length !== factValues.length) { counts.pendingReview++; scopeComplete = false; add({ ...base, severity: "review", code: "INVALID_REVIEW_FACTS", title: "Revizia nu conține un set valid complet de fapte." }); continue; }
        counts.verifiedDocuments++;
        for (const fact of facts) {
          if (counts.factsCompared >= 5000) { scopeComplete = false; factLimitReached = true; limitations.push("Limita acestei rulări este 5.000 de fapte verificate; împarte domeniul înaintea unei concluzii complete."); break; }
          counts.factsCompared++;
          if (fact.kind === "reservation") {
            const key = fact.locationCode.toLocaleUpperCase("ro-RO");
            const previous = locationEvidence.get(key) || [];
            const signature = canonicalDocumentValue({ periodStart: fact.periodStart, periodEnd: fact.periodEnd, contractNumber: contractKey(fact.contractNumber), clientTaxId: canonicalTaxId(fact.clientTaxId), monthlyRent: fact.monthlyRent === undefined ? null : cents(fact.monthlyRent), currency: fact.currency || null });
            if (previous.some((item) => item.periodStart <= fact.periodEnd && item.periodEnd >= fact.periodStart && item.signature !== signature)) add({ ...base, severity: "review", code: "DOCUMENT_CONTRACTS_OVERLAP", title: "Fapte contractuale diferite se suprapun pe același cod; verifică actele adiționale și versiunea valabilă.", locationCode: fact.locationCode, evidence: fact.evidence });
            previous.push({ signature, periodStart: fact.periodStart, periodEnd: fact.periodEnd }); locationEvidence.set(key, previous);
            const outcome = await compareReservationFact(tx, fact);
            counts.reservationsCompared += outcome.compared ? 1 : 0;
            for (const finding of outcome.findings) add({ ...base, evidence: fact.evidence, locationCode: fact.locationCode, ...finding });
          } else {
            const outcome = await compareInvoiceFact(tx, fact);
            counts.invoicesCompared += outcome.compared ? 1 : 0;
            for (const finding of outcome.findings) add({ ...base, evidence: fact.evidence, ...finding });
          }
        }
        if (factLimitReached) break;
      }
      if (factLimitReached) break;
      cursor = documents.at(-1)!.id;
      if (counts.documents >= 5000) { scopeComplete = false; limitations.push("Limita acestei rulări este 5.000 de referințe; domeniul trebuie împărțit în surse mai mici înainte de o concluzie completă."); break; }
      if (documents.length < 100) break;
    }
    if (!counts.documents) { scopeComplete = false; limitations.push("Nicio referință sincronizată în sursele active; lipsa fișierelor nu înseamnă lipsa diferențelor."); }
    counts.findingsStored = findings.length;
    if (counts.differences + counts.needsReview > findings.length) limitations.push("Detaliile sunt limitate la primele 200 de constatări; totalurile includ toate referințele procesate. Folosește lista paginată pentru restul documentelor.");
    const sourceSnapshotHash = documentHash(evidenceKeys.sort().join("\n"));
    const run = await tx.documentAuditRun.create({ data: { requestedByUserId: current.id, asOf, sourceSnapshotHash, scopeComplete, counts, findings, limitations: [...new Set(limitations)] } });
    await recordTransactionalAudit(tx, { actor: current, action: "document_audit.run_completed", entityType: "document_audit_run", entityId: run.id, metadata: { trigger: context.trigger || "manual", delegatedSourceId: context.delegatedSourceId || null, sourceSnapshotHash, scopeComplete, counts, businessRowsModified: 0 } });
    return { id: run.id, asOf: asOf.toISOString(), scopeComplete, counts, findings, limitations: [...new Set(limitations)], sourceSnapshotHash, businessRowsModified: 0 };
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 60000 });
}

/** Server-only cron delegation. No source credential or invented browser
 * session is used: current issuer role/version is checked again by the writer. */
export async function runScheduledDocumentAudit() {
  const sources = await prisma.documentAuditSource.findMany({ where: { state: "active", ingestTokenHash: { not: null } }, orderBy: { id: "asc" }, take: 100, select: { id: true, ownerUserId: true, ownerTokenVersion: true } });
  if (!sources.length) return { state: "no_authorized_source", reportGenerated: false, businessRowsModified: 0, reason: "Nicio sursă activă cu delegație emisă; NAS-ul real nu a fost verificat." };
  const owners = await prisma.user.findMany({ where: { id: { in: [...new Set(sources.map((source) => source.ownerUserId))] } }, select: { id: true, email: true, name: true, active: true, role: true, tokenVersion: true } });
  const source = sources.find((item) => owners.some((owner) => owner.id === item.ownerUserId && owner.active && mayManageDocumentAudit(owner.role) && owner.tokenVersion === item.ownerTokenVersion));
  const owner = source ? owners.find((item) => item.id === source.ownerUserId)! : null;
  if (!source || !owner) return { state: "delegation_revoked", reportGenerated: false, businessRowsModified: 0, reason: "Drepturile emitentului delegației s-au schimbat; raportul automat este suspendat." };
  const now = Math.floor(Date.now() / 1000);
  const actor: AuthSession = { id: owner.id, name: owner.name, email: owner.email, role: owner.role as AuthSession["role"], tokenVersion: owner.tokenVersion, iat: now, exp: now + 120, auditRequestId: "document-audit-cron:" + source.id };
  const report = await runDocumentReconciliation(actor, { trigger: "scheduled", delegatedSourceId: source.id });
  return { state: "reusedRecentSnapshot" in report ? "recent_report_available" : report.scopeComplete ? "report_generated" : "incomplete_report_generated", reportGenerated: true, runId: report.id, asOf: report.asOf, scopeComplete: report.scopeComplete, counts: report.counts, businessRowsModified: 0, coverage: "Numai referințe NAS sincronizate și fapte confirmate; verifică prospețimea și limitele din aplicație." };
}

type FindingContent = Omit<DocumentAuditFinding, "documentId" | "documentVersionId" | "sourceSha256" | "evidence" | "locationCode">;
async function compareReservationFact(tx: Tx, fact: Extract<DocumentFact, { kind: "reservation" }>) {
  const findings: FindingContent[] = [];
  const location = await tx.location.findUnique({ where: { code: fact.locationCode }, select: { id: true } });
  if (!location) return { compared: false, findings: [{ code: "LOCATION_NOT_FOUND", severity: "difference", title: "Codul din contract nu există în inventarul aplicației." }] as FindingContent[] };
  const rows = await tx.reservation.findMany({ where: { locationId: location.id, ...(fact.reservationId ? { id: fact.reservationId } : { status: { in: ["BOOKED", "HOLD", "RESERVED"] } }) }, orderBy: { id: "asc" }, take: 201,
    select: { id: true, status: true, periodStart: true, periodEnd: true, holdExpiresAt: true, createdAt: true, contractNumber: true, currency: true, monthlyRentShare: true, amount: true, client: { select: { taxId: true } } } });
  if (rows.length > 200) return { compared: false, findings: [{ code: "RESERVATION_SCOPE_TOO_LARGE", severity: "review", title: "Codul are prea multe înregistrări pentru asociere sigură; indică rezervarea exactă." }] as FindingContent[] };
  let candidates = rows;
  if (!fact.reservationId) {
    const contract = fact.contractNumber ? rows.filter((row) => contractKey(row.contractNumber) === contractKey(fact.contractNumber)) : [];
    const exact = rows.filter((row) => day(row.periodStart) === fact.periodStart && day(row.periodEnd) === fact.periodEnd);
    const overlaps = rows.filter((row) => day(row.periodStart) <= fact.periodEnd && day(row.periodEnd) >= fact.periodStart);
    candidates = contract.length ? contract : exact.length ? exact : overlaps;
  }
  if (candidates.length !== 1) return { compared: false, findings: [{ code: candidates.length ? "RESERVATION_MATCH_AMBIGUOUS" : "BOOKING_NOT_FOUND", severity: candidates.length ? "review" : "difference", title: candidates.length ? "Mai multe rezervări pot corespunde documentului; asocierea trebuie aleasă explicit." : "Nu există o rezervare asociabilă sigur acestui cod și contract.", href: "/admin/locatii" }] as FindingContent[] };
  const row = candidates[0], base = { targetType: "reservation" as const, targetId: row.id, href: `/admin/locatii?reservationId=${encodeURIComponent(row.id)}&reservationAction=edit` };
  const conflictingRows = await tx.reservation.findMany({ where: { locationId: location.id, id: { not: row.id }, status: { in: ["BOOKED", "HOLD", "RESERVED"] }, periodStart: { lte: new Date(fact.periodEnd + "T00:00:00.000Z") }, periodEnd: { gte: new Date(fact.periodStart + "T00:00:00.000Z") } }, take: 201, select: { status: true, holdExpiresAt: true, createdAt: true } });
  if (conflictingRows.some((other) => isEffectiveBlockingReservation(other))) findings.push({ ...base, code: "APP_BOOKING_OVERLAP", severity: "review", title: "Aplicația conține alte blocări efective pe cod în perioada confirmată; verifică suprapunerea înaintea oricărei corecții." });
  if (row.status !== "BOOKED") findings.push({ ...base, code: "BOOKING_STATUS_DIFFERS", severity: "difference", title: "Contractul verificat nu este înregistrat ca rezervare confirmată.", current: { status: row.status }, proposed: { status: "BOOKED" } });
  if (day(row.periodStart) !== fact.periodStart || day(row.periodEnd) !== fact.periodEnd) findings.push({ ...base, code: "BOOKING_PERIOD_DIFFERS", severity: "difference", title: "Perioada din aplicație diferă de faptele confirmate din contract.", current: { periodStart: day(row.periodStart), periodEnd: day(row.periodEnd) }, proposed: { periodStart: fact.periodStart, periodEnd: fact.periodEnd } });
  if (fact.currency && row.currency !== fact.currency) findings.push({ ...base, code: "BOOKING_CURRENCY_DIFFERS", severity: "difference", title: "Moneda rezervării diferă de moneda explicită din document.", current: { currency: row.currency }, proposed: { currency: fact.currency } });
  if (fact.monthlyRent !== undefined) {
    if (!fact.currency) findings.push({ ...base, code: "RENT_CURRENCY_UNVERIFIED", severity: "review", title: "Chiria nu poate fi comparată fără moneda explicită din document." });
    else if (row.currency === fact.currency && cents(row.monthlyRentShare ?? row.amount) !== cents(fact.monthlyRent)) findings.push({ ...base, code: "BOOKING_MONTHLY_RENT_DIFFERS", severity: "difference", title: "Chiria lunară pe cod diferă de valoarea explicită verificată.", current: { monthlyRent: cents(row.monthlyRentShare ?? row.amount), currency: row.currency }, proposed: { monthlyRent: cents(fact.monthlyRent), currency: fact.currency } });
  }
  if (fact.contractNumber && contractKey(row.contractNumber) !== contractKey(fact.contractNumber)) findings.push({ ...base, code: "CONTRACT_NUMBER_DIFFERS", severity: "difference", title: "Numărul contractului diferă.", current: { contractNumber: row.contractNumber }, proposed: { contractNumber: fact.contractNumber } });
  if (fact.clientTaxId) {
    const currentTaxId = canonicalTaxId(row.client?.taxId);
    if (!currentTaxId) findings.push({ ...base, code: "BOOKING_CLIENT_IDENTITY_UNVERIFIED", severity: "review", title: "Clientul rezervării nu are un CUI asociat verificabil." });
    else if (currentTaxId !== canonicalTaxId(fact.clientTaxId)) findings.push({ ...base, code: "BOOKING_CLIENT_IDENTITY_DIFFERS", severity: "difference", title: "Clientul asociat rezervării diferă de partea contractuală verificată.", current: { clientTaxId: currentTaxId }, proposed: { clientTaxId: canonicalTaxId(fact.clientTaxId) } });
  }
  return { compared: true, findings };
}

async function compareInvoiceFact(tx: Tx, fact: Extract<DocumentFact, { kind: "invoice" }>) {
  if (new Prisma.Decimal(fact.grossAmount).isNegative()) return { compared: false, findings: [{ code: "CREDIT_NOTE_REVIEW_REQUIRED", severity: "review", title: "Storno-ul verificat cere reconcilierea ajustărilor facturii; nu înlocuiește valoarea facturii originale." }] as FindingContent[] };
  const normalized = normalizeReceivableInvoiceNumber(fact.invoiceNumber);
  const rows = await tx.financialReceivable.findMany({ where: { includedInReport: true, AND: [
    { OR: [{ normalizedInvoiceNumber: normalized }, { invoiceNumber: fact.invoiceNumber }] },
    { OR: [{ canonicalKey: { not: null } }, { upload: { status: "confirmed", OR: [{ activeVersion: true }, { fileHash: { startsWith: "smartbill-" } }] } }] },
  ] }, take: 201,
    select: { id: true, canonicalKey: true, companyCode: true, invoiceNumber: true, normalizedInvoiceNumber: true, invoicedAmount: true, currency: true, invoiceDate: true, status: true, needsReview: true, client: { select: { taxId: true } } } });
  if (rows.length > 200) return { compared: false, findings: [{ code: "INVOICE_MATCH_AMBIGUOUS", severity: "review", title: "Prea multe importuri pot corespunde facturii; asocierea fiscală trebuie verificată." }] as FindingContent[] };
  const company = rows.filter((row) => invoiceCompany(row.companyCode) === fact.companyCode);
  const canonical = company.filter((row) => row.canonicalKey);
  const relevant = canonical.length ? canonical : company;
  if (relevant.length !== 1) return { compared: false, findings: [{ code: relevant.length ? "INVOICE_MATCH_AMBIGUOUS" : "INVOICE_NOT_FOUND", severity: relevant.length ? "review" : "difference", title: relevant.length ? "Există mai multe înregistrări fiscale posibile; verifică registrul canonic." : "Factura nu a fost găsită pentru emitentul verificat.", href: "/admin/financiar/incasari" }] as FindingContent[] };
  const row = relevant[0], findings: FindingContent[] = [], base = { targetType: "receivable" as const, targetId: row.id, href: "/admin/financiar/incasari" };
  if (row.needsReview || ["cancelled", "archived"].includes(row.status)) findings.push({ ...base, code: "INVOICE_REGISTER_REVIEW_REQUIRED", severity: "review", title: "Înregistrarea fiscală este marcată pentru verificare, anulată sau arhivată; verifică starea înaintea concluziei." });
  if (row.currency !== fact.currency) findings.push({ ...base, code: "INVOICE_CURRENCY_DIFFERS", severity: "difference", title: "Moneda facturii din registru diferă de document.", current: { currency: row.currency }, proposed: { currency: fact.currency } });
  if (row.currency === fact.currency && cents(row.invoicedAmount) !== cents(fact.grossAmount)) findings.push({ ...base, code: "INVOICE_GROSS_DIFFERS", severity: "difference", title: "Valoarea originală facturată diferă de valoarea brută verificată; plățile și ajustările nu sunt rescrise.", current: { grossAmount: cents(row.invoicedAmount), currency: row.currency }, proposed: { grossAmount: cents(fact.grossAmount), currency: fact.currency } });
  if (fact.invoiceDate && (!row.invoiceDate || day(row.invoiceDate) !== fact.invoiceDate)) findings.push({ ...base, code: "INVOICE_DATE_DIFFERS", severity: "difference", title: "Data facturii diferă.", current: { invoiceDate: row.invoiceDate ? day(row.invoiceDate) : null }, proposed: { invoiceDate: fact.invoiceDate } });
  if (fact.clientTaxId) {
    const currentTaxId = canonicalTaxId(row.client?.taxId);
    if (!currentTaxId) findings.push({ ...base, code: "INVOICE_CLIENT_IDENTITY_UNVERIFIED", severity: "review", title: "Factura nu are un client cu identitate fiscală verificabilă în aplicație." });
    else if (currentTaxId !== canonicalTaxId(fact.clientTaxId)) findings.push({ ...base, code: "INVOICE_CLIENT_IDENTITY_DIFFERS", severity: "difference", title: "Identitatea fiscală a clientului diferă de factura verificată.", current: { clientTaxId: currentTaxId }, proposed: { clientTaxId: canonicalTaxId(fact.clientTaxId) } });
  }
  return { compared: true, findings };
}
