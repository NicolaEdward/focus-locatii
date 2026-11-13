export type CrmCommandIntention = {
  key: string;
  payload: Record<string, unknown>;
  state: "ready" | "sending" | "committed" | "rejected" | "unknown" | "partial";
  auditRequestId?: string | null;
};
export type CrmCommandOutcome = {
  outcome: "committed" | "rejected" | "unknown" | "partial";
  message: string;
  code?: string;
  result?: unknown;
  records?: { kind: string; id: string }[];
};
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const unknownMessage = "Rezultatul nu poate fi confirmat. Verifică dosarul și istoricul. Comanda nu va fi retrimisă automat.";

export function createCrmCommandIntention(payload: Record<string, unknown>, key = crypto.randomUUID()): CrmCommandIntention {
  return { key, payload: { ...payload, idempotencyKey: key }, state: "ready" };
}

export async function sendCrmCommandIntention(intent: CrmCommandIntention, fetcher: Fetcher = fetch): Promise<CrmCommandOutcome> {
  // This is an intention key, not a claim that every legacy command is idempotent.
  // Once a write may have happened, only read-only verification is allowed.
  if (!["ready", "rejected"].includes(intent.state)) return { outcome: intent.state === "committed" ? "committed" : "unknown", message: unknownMessage };
  intent.state = "sending";
  try {
    const response = await fetcher("/api/admin/crm/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent.payload), cache: "no-store" });
    const data = await response.json().catch(() => null);
    intent.auditRequestId = data?.auditRequestId;
    if (response.ok && data?.outcome === "committed") {
      intent.state = "committed";
      return { outcome: "committed", result: data.result, message: data.warning || "" };
    }
    if (data?.outcome === "rejected" || response.status === 401 || response.status === 403) {
      intent.state = "rejected";
      return { outcome: "rejected", code: data?.code, message: data?.error || "Comanda a fost refuzată." };
    }
    intent.state = "unknown";
    return { outcome: "unknown", code: data?.code, message: data?.error || unknownMessage };
  } catch {
    intent.state = "unknown";
    return { outcome: "unknown", message: unknownMessage };
  }
}

export async function verifyCrmCommandIntention(intent: CrmCommandIntention, fetcher: Fetcher = fetch): Promise<CrmCommandOutcome> {
  try {
    const response = await fetcher(`/api/admin/crm/commands?intentKey=${encodeURIComponent(intent.key)}`, { method: "GET", cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !["committed", "partial", "unknown"].includes(data?.outcome)) return { outcome: "unknown", message: unknownMessage };
    intent.state = data.outcome;
    return { outcome: data.outcome, message: data.message || unknownMessage, records: Array.isArray(data.records) ? data.records : [] };
  } catch { return { outcome: "unknown", message: unknownMessage }; }
}
