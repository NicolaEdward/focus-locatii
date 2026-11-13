import { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bucharestDateKey } from "@/lib/campaigns/campaign-effective-status";
import { reservationDetailsWhere } from "@/lib/reservation-read-access";
import { documentFactSchema, mayReadDocumentAudit } from "@/lib/document-source-domain";
import { normalizeCompanyEntity } from "@/lib/company-entities";
import { getValidatedPriceIntervals } from "@/lib/segmented-billing";
import { CONTRACT_CONTROL_ROLES, compareContractEvidence, contractControlQuerySchema, contractIssueLabels, contractRecordScope, type ContractEvidence, type ContractIssue } from "@/lib/contract-control-domain";

export class ContractControlError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}
export function mayReadContractControl(role: string) { return (CONTRACT_CONTROL_ROLES as readonly string[]).includes(role); }
const day = (value: Date) => value.toISOString().slice(0, 10);
const money = (value: Prisma.Decimal.Value | null | undefined) => value == null ? null : new Prisma.Decimal(value).toFixed(2);
const rowLimit = 10_000;

/** Read-only report. Only explicit reviews of current indexed originals can
 * establish a match. Attached files, import labels and absence of findings do not. */
export async function getContractControlReport(raw: unknown, actor: AuthSession, now = new Date()) {
  if (!mayReadContractControl(actor.role)) throw new ContractControlError("Nu ai acces la controlul contractual.", 403, "CONTRACT_CONTROL_FORBIDDEN");
  const query = contractControlQuerySchema.parse(raw);
  const today = bucharestDateKey(now), globalScope = actor.role !== "SALES_AGENT";
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, tokenVersion: true } });
    if (!user?.active || user.role !== actor.role || user.tokenVersion !== actor.tokenVersion) throw new ContractControlError("Sesiunea s-a schimbat. Autentifică-te din nou.", 401, "CONTRACT_CONTROL_SESSION_CHANGED");
    const [reservations, sources, documents, unassignedClients] = await Promise.all([
      tx.reservation.findMany({ where: { AND: [{ status: "BOOKED" }, reservationDetailsWhere(actor)] }, orderBy: [{ periodEnd: "desc" }, { id: "asc" }], take: rowLimit + 1,
        select: { id: true, locationId: true, clientId: true, campaignId: true, clientName: true, campaignName: true, periodStart: true, periodEnd: true, contractNumber: true, contractCompany: true,
          amount: true, monthlyRentShare: true, monthlyRentTotal: true, currency: true, updatedAt: true, sellerUserId: true, ownerId: true,
          location: { select: { code: true, city: true, address: true, type: true, status: true } },
          client: { select: { companyName: true, taxId: true, accountOwnerUserId: true } },
          campaign: { select: { campaignName: true, companyEntity: true, sellerUserId: true } },
          sellerUser: { select: { id: true, name: true, active: true } }, owner: { select: { id: true, name: true, active: true } },
          priceSegments: { orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }], select: { effectiveFrom: true, effectiveTo: true, monthlyRent: true, currency: true } },
        } }),
      tx.documentAuditSource.findMany({ where: { state: "active" }, select: { id: true, lastCompletedScanAt: true, maxStaleHours: true, activeScanId: true } }),
      tx.sourceDocument.findMany({ where: { source: { state: "active" }, documentType: "contract" }, orderBy: { id: "asc" }, take: rowLimit + 1,
        select: { id: true, sourceId: true, displayName: true, state: true, currentVersionId: true } }),
      globalScope ? tx.clientAccount.count({ where: { accountOwnerUserId: null, status: { notIn: ["archived", "merged"] } } }) : Promise.resolve(null),
    ]);
    const complete = reservations.length <= rowLimit && documents.length <= rowLimit;
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const freshSource = (id: string) => { const source = sourceById.get(id); return Boolean(source && !source.activeScanId && source.lastCompletedScanAt && now.getTime() - source.lastCompletedScanAt.getTime() <= source.maxStaleHours * 3600000); };
    const pageDocuments = documents.slice(0, rowLimit);
    const versions = await tx.sourceDocumentVersion.findMany({ where: { id: { in: pageDocuments.map((doc) => doc.currentVersionId).filter((id): id is string => Boolean(id)) } },
      select: { id: true, documentId: true, sha256: true, reviewVersion: true, reviews: { orderBy: { version: "desc" }, take: 1, select: { version: true, state: true, facts: true, reviewedAt: true } } } });
    const versionsById = new Map(versions.map((version) => [version.id, version]));
    const evidence: ContractEvidence[] = [];
    let pendingDocuments = 0, evidenceTruncated = false;
    for (const doc of pageDocuments) {
      const version = doc.currentVersionId ? versionsById.get(doc.currentVersionId) : null, review = version?.reviews[0];
      if (!version || version.documentId !== doc.id || !review || review.state !== "verified" || review.version !== version.reviewVersion || !Array.isArray(review.facts)) { pendingDocuments++; continue; }
      for (const rawFact of review.facts) {
        const parsed = documentFactSchema.safeParse(rawFact);
        if (!parsed.success || parsed.data.kind !== "reservation") continue;
        if (evidence.length >= 10_000) { evidenceTruncated = true; break; }
        evidence.push({ documentId: doc.id, documentVersionId: version.id, displayName: doc.displayName, sha256: version.sha256, reviewVersion: review.version, reviewedAt: review.reviewedAt.toISOString(), fresh: doc.state === "present" && freshSource(doc.sourceId), fact: parsed.data });
      }
    }
    const evidenceByReservation = new Map<string, ContractEvidence[]>(), evidenceByCode = new Map<string, ContractEvidence[]>();
    for (const value of evidence) {
      const index = value.fact.reservationId ? evidenceByReservation : evidenceByCode;
      const key = value.fact.reservationId || value.fact.locationCode.trim().toLocaleUpperCase("ro-RO");
      const list = index.get(key) || []; list.push(value); index.set(key, list);
    }
    const rows = reservations.slice(0, rowLimit).map((row) => {
      const periodStart = day(row.periodStart), periodEnd = day(row.periodEnd), scope = contractRecordScope(periodStart, periodEnd, today);
      // The current or first contracted day determines the displayed monthly
      // rent. Historical segments remain visible and are never flattened.
      const priceDate = scope === "current" ? today : scope === "upcoming" ? periodStart : periodEnd;
      const headerRent = row.monthlyRentShare ?? row.amount ?? row.monthlyRentTotal;
      const schedule = getValidatedPriceIntervals({ periodStart: row.periodStart, periodEnd: row.periodEnd, monthlyAmount: headerRent ?? 0, currency: row.currency }, row.priceSegments);
      const applicable = schedule.valid ? schedule.intervals.find((interval) => day(interval.periodStart) <= priceDate && day(interval.periodEnd) >= priceDate) : null;
      // Once a segmented history exists, a gap/overlap must never fall back to
      // the denormalized header and certify a price that billing cannot use.
      const monthlyRent = applicable ? money(applicable.monthlyRent) : null;
      const currency = applicable ? applicable.currency : row.currency;
      const candidates = [...(evidenceByReservation.get(row.id) || []), ...(evidenceByCode.get(row.location.code.trim().toLocaleUpperCase("ro-RO")) || [])];
      const comparison = compareContractEvidence({ id: row.id, locationCode: row.location.code, periodStart, periodEnd, contractNumber: row.contractNumber, contractCompany: row.contractCompany, clientTaxId: row.client?.taxId || null, monthlyRent, currency, priceDate, priceScheduleValid: schedule.valid }, candidates);
      const issues: ContractIssue[] = [];
      if (!(headerRent != null && headerRent > 0) && !row.priceSegments.some((segment) => segment.monthlyRent.gt(0))) issues.push("missing_price");
      if (!["EUR", "RON"].includes(currency || "")) issues.push("missing_currency");
      if (!row.contractNumber?.trim()) issues.push("missing_contract");
      const entity = normalizeCompanyEntity(row.contractCompany), campaignEntity = normalizeCompanyEntity(row.campaign?.companyEntity);
      if (!entity || !campaignEntity) issues.push("missing_entity");
      else if (entity !== campaignEntity) issues.push("entity_mismatch");
      if (!row.clientId || !row.campaignId) issues.push("missing_client_campaign");
      const responsible = row.sellerUser?.active ? row.sellerUser : row.owner?.active ? row.owner : null;
      if (!responsible) issues.push("missing_owner");
      if (!schedule.valid) issues.push("price_history_invalid");
      if (schedule.reasons.includes("PRICE_SEGMENT_OVERLAP")) issues.push("price_history_conflict");
      if (new Set(row.priceSegments.map((segment) => `${money(segment.monthlyRent)}:${segment.currency}`)).size > 1) issues.push("price_history_review");
      const evidenceIssue = { unverified: "evidence_missing", stale: "evidence_stale", partial: "evidence_partial", conflicting: "evidence_conflict", difference: "contract_difference", matched: null } as const;
      if (evidenceIssue[comparison.state]) issues.push(evidenceIssue[comparison.state]!);
      const nextAction = issues.includes("entity_mismatch") ? "Verifică firma din contract și emitentul facturii înaintea corecției."
        : issues.includes("missing_price") ? "Confirmă chiria pe amplasament din contract sau actul adițional valabil."
          : issues.includes("price_history_invalid") ? "Reconciliază intervalele chiriei cu actele adiționale; nu folosi prețul din antet ca înlocuitor al istoricului."
          : comparison.state === "difference" || comparison.state === "conflicting" ? "Verifică originalul și actele adiționale; pregătește o corecție cu data efectivă."
            : issues.includes("missing_client_campaign") ? "Asociază clientul și campania, păstrând istoricul închirierii."
              : issues.includes("missing_owner") ? "Directorul comercial trebuie să atribuie un responsabil."
                : comparison.state !== "matched" ? "Verifică originalul în arhivă și înregistrează valorile contractuale cu pagină și dovadă."
                  : "Contractul corespunde în câmpurile verificate; urmărește expirarea și actele adiționale.";
      return {
        id: row.id, locationId: row.locationId, locationCode: row.location.code, city: row.location.city, address: row.location.address,
        clientId: row.clientId, clientName: row.client?.companyName || row.clientName, campaignId: row.campaignId, campaignName: row.campaign?.campaignName || row.campaignName,
        periodStart, periodEnd, scope, contractNumber: row.contractNumber, contractCompany: row.contractCompany, campaignEntity: row.campaign?.companyEntity || null,
        monthlyRent, currency, priceDate, priceSchedule: { valid: schedule.valid, reasons: schedule.reasons }, priceSegments: row.priceSegments.map((segment) => ({ effectiveFrom: day(segment.effectiveFrom), effectiveTo: segment.effectiveTo ? day(segment.effectiveTo) : null, monthlyRent: money(segment.monthlyRent), currency: segment.currency })),
        responsible: responsible ? { id: responsible.id, name: responsible.name } : null, updatedAt: row.updatedAt.toISOString(), issues, nextAction,
        evidence: { state: comparison.state, differences: comparison.differences,
          documents: comparison.documents.map((document) => mayReadDocumentAudit(actor.role) ? { documentId: document.documentId, documentVersionId: document.documentVersionId, displayName: document.displayName, sha256: document.sha256, reviewVersion: document.reviewVersion, reviewedAt: document.reviewedAt, fresh: document.fresh, evidence: document.fact.evidence } : { reviewedAt: document.reviewedAt, fresh: document.fresh }) },
        href: `/admin/locatii?reservationId=${encodeURIComponent(row.id)}#rezervari`,
      };
    });
    const scopeRows = query.scope === "all" ? rows : rows.filter((row) => row.scope === query.scope);
    const normalizedSearch = query.q.toLocaleLowerCase("ro-RO");
    const filtered = scopeRows.filter((row) => (!query.entity || normalizeCompanyEntity(row.contractCompany) === normalizeCompanyEntity(query.entity))
      && (!normalizedSearch || [row.locationCode, row.city, row.clientName, row.campaignName, row.contractNumber, row.responsible?.name].some((value) => value?.toLocaleLowerCase("ro-RO").includes(normalizedSearch)))
      && (query.issue === "all" || query.issue === "any" && row.issues.length > 0 || row.issues.includes(query.issue as ContractIssue))
      && (query.evidence === "all" || query.evidence === "matched" && row.evidence.state === "matched" || query.evidence === "difference" && ["difference", "conflicting"].includes(row.evidence.state) || query.evidence === "unverified" && ["unverified", "partial", "stale"].includes(row.evidence.state)));
    const totalPages = Math.max(1, Math.ceil(filtered.length / query.pageSize)), page = Math.min(query.page, totalPages);
    const issueCounts = Object.fromEntries(Object.keys(contractIssueLabels).map((issue) => [issue, scopeRows.filter((row) => row.issues.includes(issue as ContractIssue)).length])) as Record<ContractIssue, number>;
    const sourceCoverage = !sources.length ? "unconfigured" : sources.some((source) => !freshSource(source.id)) ? "sync_required" : "indexed";
    return {
      generatedAt: now.toISOString(), businessDate: today, portfolioScope: globalScope ? "company" as const : "own" as const,
      complete: complete && !evidenceTruncated, query: { ...query, page },
      summary: { bookedRecords: rows.length, current: rows.filter((row) => row.scope === "current").length, upcoming: rows.filter((row) => row.scope === "upcoming").length, historical: rows.filter((row) => row.scope === "history").length,
        inScope: scopeRows.length, verified: scopeRows.filter((row) => row.evidence.state === "matched" && !row.issues.length).length, needsAttention: scopeRows.filter((row) => row.issues.length).length, issues: issueCounts, unassignedClients },
      source: { state: sourceCoverage, activeSources: sources.length, indexedContracts: pageDocuments.length, pendingDocuments, comparedFacts: evidence.length, verifiedWholeCompany: false as const },
      permissions: { documentAudit: mayReadDocumentAudit(actor.role), ownershipRemediation: ["COO", "SUPER_ADMIN"].includes(actor.role) },
      limitations: [
        "Raportul descrie închirierile BOOKED din aplicație; nu dovedește că toate contractele companiei sunt deja înregistrate.",
        "Concordanța cere o verificare umană a originalului curent: amplasament, perioadă, client, număr, firmă, chirie și monedă. Fișierul atașat singur nu dovedește aceste valori.",
        "Chiria afișată este cea aplicabilă datei indicate. Actele adiționale și prețurile istorice trebuie evaluate pe intervalele lor; totalurile de contract nu se împart automat.",
        ...(!complete || evidenceTruncated ? ["Raport parțial: limita de 10.000 de închirieri, referințe sau fapte a fost atinsă. Nu folosi totalurile drept inventar complet."] : []),
      ],
      pagination: { total: filtered.length, page, pageSize: query.pageSize, totalPages },
      rows: filtered.slice((page - 1) * query.pageSize, page * query.pageSize),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 30000 });
}
export type ContractControlReport = Awaited<ReturnType<typeof getContractControlReport>>;
