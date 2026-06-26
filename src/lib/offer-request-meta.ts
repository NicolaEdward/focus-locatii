export type OfferRequestMeta = {
  source?: string | null;
  salesperson?: string | null;
  deletedAt?: string | null;
  crmStatus?: string | null;
  estimatedValue?: number | null;
  nextFollowUpAt?: string | null;
  notes?: string | null;
  lastActivityAt?: string | null;
};

const META_PATTERN = /<!--focus-request:([\s\S]*?)-->/;

export function parseOfferRequestMeta(value?: string | null): OfferRequestMeta {
  const source = stripOfferRequestMeta(value);
  const match = String(value || "").match(META_PATTERN);
  if (!match) return { source };

  try {
    const parsed = JSON.parse(match[1]) as OfferRequestMeta;
    return {
      source,
      salesperson: clean(parsed.salesperson),
      deletedAt: clean(parsed.deletedAt),
      crmStatus: clean(parsed.crmStatus),
      estimatedValue: typeof parsed.estimatedValue === "number" && Number.isFinite(parsed.estimatedValue) ? parsed.estimatedValue : null,
      nextFollowUpAt: clean(parsed.nextFollowUpAt),
      notes: clean(parsed.notes),
      lastActivityAt: clean(parsed.lastActivityAt)
    };
  } catch {
    return { source };
  }
}

export function stripOfferRequestMeta(value?: string | null) {
  return String(value || "").replace(META_PATTERN, "").trim() || null;
}

export function withOfferRequestMeta(value: string | null | undefined, patch: Omit<OfferRequestMeta, "source">) {
  const source = stripOfferRequestMeta(value) || "portal-client";
  const current = parseOfferRequestMeta(value);
  const next = {
    salesperson: patch.salesperson ?? current.salesperson ?? null,
    deletedAt: patch.deletedAt ?? current.deletedAt ?? null,
    crmStatus: patch.crmStatus ?? current.crmStatus ?? null,
    estimatedValue: patch.estimatedValue ?? current.estimatedValue ?? null,
    nextFollowUpAt: patch.nextFollowUpAt ?? current.nextFollowUpAt ?? null,
    notes: patch.notes ?? current.notes ?? null,
    lastActivityAt: patch.lastActivityAt ?? current.lastActivityAt ?? null
  };

  return `${source}\n<!--focus-request:${JSON.stringify(next)}-->`;
}

function clean(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}
