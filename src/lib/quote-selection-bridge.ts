/** Browser-local handoff only. The server re-authorizes every ID and recomputes
 * availability, prices and totals when the commercial draft is saved. */
export type QuoteSelectionDraft = {
  ownerUserId: string;
  createdAt: number;
  clientId?: string;
  campaignId?: string;
  opportunityId?: string;
  clientName: string;
  campaignName: string;
  companyEntity: string;
  periodStart: string;
  periodEnd: string;
  locationIds: string[];
};

const prefix = "focus-quote-selection:";
const lifetime = 30 * 60 * 1000;
const safeId = /^[a-zA-Z0-9_-]{1,191}$/;
const dateKey = /^\d{4}-\d{2}-\d{2}$/;

export function validateQuoteSelectionDraft(value: unknown, userId: string, now = Date.now()): QuoteSelectionDraft | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!userId || v.ownerUserId !== userId || typeof v.createdAt !== "number" || !Number.isFinite(v.createdAt) || v.createdAt > now + 5000 || now - v.createdAt > lifetime) return null;
  if (typeof v.periodStart !== "string" || !dateKey.test(v.periodStart) || typeof v.periodEnd !== "string" || !dateKey.test(v.periodEnd) || v.periodStart > v.periodEnd) return null;
  if ([v.periodStart, v.periodEnd].some((value) => { const d = new Date(value as string); return !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value; })) return null;
  if (!Array.isArray(v.locationIds) || !v.locationIds.length || v.locationIds.length > 50 || v.locationIds.some((id) => typeof id !== "string" || !safeId.test(id))) return null;
  for (const key of ["clientName", "campaignName", "companyEntity"]) if (typeof v[key] !== "string" || (v[key] as string).length > 191) return null;
  for (const key of ["clientId", "campaignId", "opportunityId"]) if (v[key] !== undefined && (typeof v[key] !== "string" || !safeId.test(v[key] as string))) return null;
  return { ...v, locationIds: [...new Set(v.locationIds)] } as QuoteSelectionDraft;
}

export function saveQuoteSelectionDraft(draft: QuoteSelectionDraft): string {
  const validated = validateQuoteSelectionDraft(draft, draft.ownerUserId);
  if (!validated) throw new Error("Selectează între 1 și 50 de locații și o perioadă completă înainte de ofertare.");
  const key = crypto.randomUUID();
  // Session storage keeps the handoff in this tab, isolated by account and expiry.
  window.sessionStorage.setItem(prefix + draft.ownerUserId + ":" + key, JSON.stringify(validated));
  return key;
}

export function readQuoteSelectionDraft(key: string, userId: string): QuoteSelectionDraft | null {
  if (!safeId.test(key) || !safeId.test(userId)) return null;
  try {
    const storageKey = prefix + userId + ":" + key;
    const value = window.sessionStorage.getItem(storageKey);
    const draft = value ? validateQuoteSelectionDraft(JSON.parse(value), userId) : null;
    if (!draft) window.sessionStorage.removeItem(storageKey);
    return draft;
  } catch { return null; }
}
