import crypto from "node:crypto";
import { z } from "zod";

export class DocumentAuditError extends Error {
  constructor(message: string, public status = 400, public code = "DOCUMENT_AUDIT_INVALID") { super(message); }
}
export const documentHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export function canonicalDocumentValue(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalDocumentValue).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalDocumentValue((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
export function canonicalSourcePath(input: string) {
  if (!input || input.length > 1024 || input !== input.trim() || /[\\\x00-\x1f\x7f?#]/.test(input) || input.startsWith("/") || /^[A-Za-z]:/.test(input)) throw new DocumentAuditError("Calea documentului trebuie să fie relativă la folderul aprobat.");
  const segments = input.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || part.startsWith(".") || part.includes(":"))) throw new DocumentAuditError("Calea documentului nu este permisă.");
  // Reject encoded traversal/separators; the bridge sends decoded filesystem paths.
  if (/%(?:2e|2f|5c|00)/i.test(input)) throw new DocumentAuditError("Calea documentului nu este permisă.");
  return segments.join("/");
}
export function approvedSourcePath(path: string, prefixes: string[]) {
  const normalized = canonicalSourcePath(path);
  return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix + "/"));
}
export function safeBaseReference(input?: string | null) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (value.length > 1000 || /[\x00-\x1f\x7f]/.test(value)) throw new DocumentAuditError("Referința NAS nu este validă.");
  let decodedInput: string; try { decodedInput = decodeURIComponent(value); } catch { throw new DocumentAuditError("Referința NAS nu este validă."); }
  if (decodedInput.split(/[\\/]/).some((part) => part === "." || part === "..")) throw new DocumentAuditError("Referința NAS nu poate conține traversări de directoare.");
  if (/^\\\\[A-Za-z0-9._-]+\\[^<>|?*]+$/.test(value)) return value;
  let url: URL; try { url = new URL(value); } catch { throw new DocumentAuditError("Folosește o adresă HTTPS/SMB, file://nas/ sau o cale de rețea NAS."); }
  let decodedPath: string; try { decodedPath = decodeURI(url.pathname); } catch { throw new DocumentAuditError("Referința NAS nu este validă."); }
  if (!["https:", "smb:", "file:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || /[\x00-\x1f\x7f]/.test(decodedPath)) throw new DocumentAuditError("Referința NAS trebuie să aibă un host de rețea, fără parole, tokenuri sau parametri de acces.");
  return url.toString();
}
export const sourceSchema = z.object({
  label: z.string().trim().min(3).max(191), sourceType: z.literal("local_bridge").default("local_bridge"),
  baseReference: z.string().max(1000).nullable().optional(),
  allowedPathPrefixes: z.array(z.string().min(1).max(200)).min(1).max(12),
  indexTextEnabled: z.boolean().default(false), maxStaleHours: z.number().int().min(1).max(168).default(24),
}).strict();
const timestamp = z.string().datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ingestSchema = z.object({
  requestKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
  scanId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
  scanComplete: z.boolean(), observedAt: timestamp,
  documents: z.array(z.object({
    path: z.string().min(1).max(1024), displayName: z.string().min(1).max(255),
    documentType: z.enum(["contract", "invoice", "unknown"]), sha256: hash,
    sizeBytes: z.number().int().min(1).max(20 * 1024 * 1024), modifiedAt: timestamp,
    extractionStatus: z.enum(["metadata_only", "text_available", "needs_ocr", "extraction_unavailable", "unsupported"]),
    textTruncated: z.boolean().optional().default(false),
    pages: z.array(z.object({ page: z.number().int().min(1).max(10000), text: z.string().max(16384) }).strict()).max(100),
    facts: z.array(z.never()).max(0).optional().default([]),
    verification: z.literal("unverified").optional().default("unverified"),
  }).strict()).max(50),
}).strict();

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const parsed = new Date(value + "T00:00:00.000Z"); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }, "Data calendaristică nu este validă.");
const positiveAmount = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);
const signedAmount = z.string().regex(/^-?\d{1,10}(?:\.\d{1,2})?$/);
const evidence = z.object({ page: z.number().int().min(1).max(10000), quote: z.string().trim().min(8).max(1200) }).strict();
export const documentFactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reservation"), locationCode: z.string().trim().min(1).max(191), periodStart: calendarDate, periodEnd: calendarDate,
    contractNumber: z.string().trim().max(191).optional(), clientTaxId: z.string().trim().min(2).max(40).optional(),
    monthlyRent: positiveAmount.optional(), currency: z.enum(["EUR", "RON"]).optional(),
    reservationId: z.string().min(1).max(191).optional(), evidence,
  }).strict().refine((value) => value.periodStart <= value.periodEnd, "Intervalul contractului nu este valid."),
  z.object({ kind: z.literal("invoice"), invoiceNumber: z.string().trim().min(1).max(191),
    companyCode: z.enum(["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"]), currency: z.enum(["EUR", "RON"]),
    grossAmount: signedAmount, invoiceDate: calendarDate.optional(), clientTaxId: z.string().trim().min(2).max(40).optional(),
    evidence,
  }).strict(),
]);
export type DocumentFact = z.infer<typeof documentFactSchema>;
export const reviewSchema = z.object({ documentVersionId: z.string().min(1).max(191), expectedReviewVersion: z.number().int().nonnegative(),
  sourceSha256: hash, originalReviewed: z.literal(true), state: z.enum(["verified", "rejected"]), note: z.string().trim().min(10).max(2000),
  facts: z.array(documentFactSchema).max(100),
}).strict().refine((value) => value.state !== "verified" || value.facts.length > 0, "Verificarea cere cel puțin un fapt explicit și dovada lui.");

export const DOCUMENT_AUDIT_READERS = ["COO", "SUPER_ADMIN", "D_CEO"] as const;
export const DOCUMENT_AUDIT_MANAGERS = ["COO", "SUPER_ADMIN"] as const;
export function mayReadDocumentAudit(role: string) { return (DOCUMENT_AUDIT_READERS as readonly string[]).includes(role); }
export function mayManageDocumentAudit(role: string) { return (DOCUMENT_AUDIT_MANAGERS as readonly string[]).includes(role); }
