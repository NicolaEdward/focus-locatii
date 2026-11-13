"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

type Policy = {
  version: number;
  vatRateBps: number;
  vatTreatment: string;
  rateCardCurrency: string;
  quoteValidityDays: number;
  approvalHours: number;
  agentToolsEnabled: boolean;
  generationEnabled: boolean;
  outboundEnabled: boolean;
  maxDailyModelCalls: number;
};
type QuotePayload = {
  clientName: string;
  campaignName: string;
  clientId: string;
  campaignId: string;
  recipient: string;
  companyEntity: string;
  periodStart: string;
  periodEnd: string;
  assumptions: string;
  currency: string;
  paymentTermDays: number | null;
  vatTreatment: string;
  vatRateBps: number;
  lines: {
    locationId: string;
    code: string;
    city: string | null;
    monthlyRate: string;
    net: string;
    tax: string;
    gross: string;
  }[];
  totals: { net: string; tax: string; gross: string };
};
type Revision = {
  id: string;
  revision: number;
  payload: QuotePayload;
  payloadHash: string;
  expiresAt: string;
  createdAt: string;
};
type Quote = {
  id: string;
  latestRevision: number;
  state: string;
  revisions: Revision[];
};
type Approval = {
  id: string;
  revisionId: string;
  action: string;
  state: string;
  expiresAt: string;
  holdExpiresAt: string | null;
  principalId: string | null;
};
type Workspace = {
  documents: {
    id: string;
    clientId: string | null;
    campaignId: string | null;
    fileName: string;
  }[];
  policy: Policy | null;
  quotes: Quote[];
  clients: { id: string; companyName: string }[];
  campaigns: {
    id: string;
    clientId: string;
    campaignName: string;
    currency: string | null;
  }[];
  opportunities: { id: string; name: string; stage: string; version: number }[];
  locations: {
    id: string;
    code: string;
    city: string | null;
    type: string | null;
    rateCardValue: number | null;
  }[];
  approvals: Approval[];
  acceptances: {
    id: string;
    revisionId: string;
    decision: string;
    evidenceReference: string;
    createdAt: string;
  }[];
  dispatches: {
    id: string;
    revisionId: string;
    recipient: string;
    state: string;
    providerReceipt: string | null;
  }[];
  profiles: {
    id: string;
    locationId: string;
    timezone: string;
    loopSeconds: number;
    slotSeconds: number;
    state: string;
    sourceReference: string;
  }[];
  playbackProofs: {
    id: string;
    bookingId: string;
    actualPlays: number;
    expectedPlays: number | null;
    sourceReference: string;
    periodStart: string;
    periodEnd: string;
  }[];
  doohBookings: {
    id: string;
    profileId: string;
    campaignId: string;
    shareBps: number;
    periodStart: string;
    periodEnd: string;
    state: string;
  }[];
  principals: {
    id: string;
    name: string;
    ownerUserId: string;
    mode: string;
    scopes: string[];
    expiresAt: string;
    revokedAt: string | null;
  }[];
  pilots: {
    id: string;
    name: string;
    mode: string;
    state: string;
    protocolHash: string;
    protocol: { maturityDays: number; objective: string };
  }[];
  delegatableOwners?: { id: string; name: string; role: string }[];
  permissions: { manage: boolean; configure: boolean; write: boolean };
  capabilities: { generationConfigured: boolean; outboundConfigured: boolean };
  commandTraces?: {
    id: string;
    principalId: string;
    tool: string;
    status: string;
    policyVersion: string;
    inputHash: string;
    outputHash: string | null;
    requestId: string;
    tokenCount: number | null;
    createdAt: string;
  }[];
};
type PilotCase = {
  id: string;
  arm: string;
  companyKeyHash: string;
  enrolledAt: string;
  reviewEvidence: string | null;
  metrics: Metrics;
};
type Metrics = {
  humanMinutes: number;
  reworkMinutes: number;
  modelCost: number;
  validSources: number;
  totalClaims: number;
  calculationErrors: number;
  unauthorizedEffects: number;
  availabilityErrors: number;
  booked: boolean;
  paidAmount: number;
  verifiedMargin: number | null;
  complaints: number;
};
type PilotReport = {
  pilot: Workspace["pilots"][number];
  arms: {
    arm: string;
    enrolled: number;
    mature: number;
    booked: number;
    paidAmount: number;
    verifiedMargin: number | null;
    humanMinutes: number;
    modelCost: number;
    sourcePrecision: number | null;
    stopRequired: boolean;
    zeroEventUpper95Approx: number | null;
  }[];
  cases: PilotCase[];
  warnings: string[];
};
type Capacity = {
  snapshotHash: string;
  available: boolean;
  remainingBps: number;
  timezone: string;
  periodStart: string;
  periodEnd: string;
  requestedShareBps: number;
  validUntil: string;
};
type Run = (action: string, input: unknown) => Promise<unknown>;
const panel =
  "min-w-0 rounded-lg border border-focus-line bg-focus-ink/70 p-4 sm:p-5";
const inputClass = "focus-input min-w-0 w-full";
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1 text-sm font-bold text-slate-300">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" className="focus-button mt-2" disabled={busy}>
      {busy ? "Se verifică…" : children}
    </button>
  );
}
function field(form: HTMLFormElement, key: string) {
  return String(new FormData(form).get(key) || "");
}
function numberField(form: HTMLFormElement, key: string) {
  return Number(field(form, key));
}
function uuid() {
  return crypto.randomUUID();
}
function date(value: string) {
  return new Date(value).toLocaleString("ro-RO");
}
const statusLabels: Record<string, string> = {
  draft: "Ciornă",
  approved: "Aprobat",
  rejected: "Respins",
  pending: "În așteptare",
  invalidated: "Invalidat",
  accepted: "Acceptat de client",
  queued: "În coadă",
  sending: "Expediere în curs",
  sent: "Expediat",
  delivered: "Livrat",
  bounced: "Nelivrat",
  unknown: "Rezultat necunoscut",
  active: "Activ",
  stopped: "Oprit",
  verified: "Verificat",
  confirmed: "Alocat",
  cancelled: "Anulat",
};
function status(value: string) {
  return statusLabels[value] || value;
}

export function CommercialWorkbench({
  tab,
}: {
  tab: "quotes" | "dooh" | "ai";
}) {
  const [data, setData] = useState<Workspace | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null),
    [draft, setDraft] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/commercial-workbench", {
        cache: "no-store",
        signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Datele nu sunt disponibile.");
      setData(body);
      setError(null);
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError"))
        setError(
          e instanceof Error ? e.message : "Datele nu sunt disponibile.",
        );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const run: Run = async (action, input) => {
    if (busy) return null;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/commercial-workbench", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, input }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Operația a fost refuzată.");
      if (action === "principal.issue") setToken(body.result.token);
      if (action === "quote.generate")
        setDraft(
          body.result.result?.draft ||
            "Comanda este în curs sau nu are o ciornă confirmată.",
        );
      setNotice("Operația a fost înregistrată și verificată.");
      await load();
      return body.result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operația a fost refuzată.");
      return null;
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="focus-container grid min-w-0 gap-5 py-6">
      <header className={panel}>
        <p className="text-sm font-bold text-focus-yellow">
          Spațiu comercial verificabil
        </p>
        <h1 className="text-2xl font-black text-white sm:text-3xl">
          {tab === "quotes"
            ? "Oferte comerciale și aprobări"
            : tab === "dooh"
              ? "Capacitate DOOH și dovada difuzării"
              : "Copilot și pilot AI"}
        </h1>
        <p className="mt-2 max-w-4xl text-sm text-slate-300">
          Versiuni de ofertă, acțiuni aprobate și rezultate urmărite.
          Disponibilitatea verificată nu reprezintă o rezervare. Confirmarea
          BOOKED rămâne în fluxul comercial autorizat.
        </p>
        <nav
          aria-label="Spații comerciale"
          className="mt-4 flex flex-wrap gap-2"
        >
          <Link
            className="focus-button secondary"
            href="/admin/commercial-quotes"
          >
            Oferte
          </Link>
          {process.env.NEXT_PUBLIC_DOOH_ENABLED === "true" ? <Link className="focus-button secondary" href="/admin/dooh">DOOH</Link> : null}
          <Link className="focus-button secondary" href="/admin/ai">
            Copilot și pilot
          </Link>
        </nav>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-400 bg-red-500/10 p-4"
        >
          <p className="font-bold text-red-100">{error}</p>
          <button
            type="button"
            className="focus-button secondary mt-3"
            onClick={() => void load()}
            disabled={loading}
          >
            Reîncearcă încărcarea
          </button>
          <p className="mt-2 text-sm text-slate-300">
            Datele afișate anterior pot fi învechite. Eroarea nu este un
            rezultat zero.
          </p>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-emerald-400/50 bg-emerald-400/10 p-3 text-emerald-100"
        >
          {notice}
        </p>
      )}
      {loading && (
        <p role="status" className="text-slate-300">
          Se încarcă datele comerciale…
        </p>
      )}
      {!data && !loading && !error && (
        <p className={panel}>Nu există date încărcate.</p>
      )}
      {data && (
        <>
          {!data.permissions.write && (
            <p className={panel}>
              Acces de citire. Acțiunile comerciale cer drepturi distincte.
            </p>
          )}
          {tab === "quotes" && <Quotes data={data} run={run} busy={busy} />}
          {tab === "dooh" && <Dooh data={data} run={run} busy={busy} />}
          {tab === "ai" && <Ai data={data} run={run} busy={busy} />}
        </>
      )}
      {token && (
        <section className={panel}>
          <h2 className="text-lg font-black text-white">
            Token nou afișat o singură dată
          </h2>
          <p className="my-2 text-sm text-slate-300">
            Salvează-l în managerul de secrete al integrării. Nu îl trimite prin
            e-mail și nu îl pune în cod. După reîncărcare nu poate fi citit din
            aplicație.
          </p>
          <input
            aria-label="Token de serviciu nou"
            type="password"
            autoComplete="off"
            readOnly
            value={token}
            className={inputClass}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="focus-button"
              onClick={() => void navigator.clipboard.writeText(token)}
            >
              Copiază tokenul
            </button>
            <button
              type="button"
              className="focus-button secondary"
              onClick={() => setToken(null)}
            >
              Am salvat și ascund
            </button>
          </div>
        </section>
      )}
      {draft && (
        <section className={panel}>
          <h2 className="text-lg font-black text-white">
            Ciornă generată pentru revizuire
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Text generat, fără drept de expediere. Calculele și termenii sunt
            cele salvate în ofertă.
          </p>
          <p className="mt-3 whitespace-pre-wrap break-words text-white">
            {draft}
          </p>
        </section>
      )}
    </main>
  );
}

function Quotes({
  data,
  run,
  busy,
}: {
  data: Workspace;
  run: Run;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [revise, setRevise] = useState<string | null>(null),
    [epoch, setEpoch] = useState(0);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [acceptanceKey, setAcceptanceKey] = useState(uuid),
    [draftKey, setDraftKey] = useState(uuid);
  const q = data.quotes.find((x) => x.id === selected),
    revision = q?.revisions.find((r) => r.id === versionId) || q?.revisions[0];
  return (
    <>
      {!data.policy && (
        <p className={panel}>
          Politica de TVA și moneda tarifelor trebuie aprobate în Copilot și
          pilot AI înainte de creare ofertă. Nu se presupun automat valori
          fiscale sau conversii valutare.
        </p>
      )}
      {data.permissions.write && data.policy && (
        <section className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-black text-white">
              {revise ? "Versiune nouă a ofertei" : "Ciornă nouă"}
            </h2>
            <button
              type="button"
              className="focus-button secondary"
              onClick={() => {
                setRevise(null);
                setEpoch((x) => x + 1);
              }}
            >
              Ciornă nouă
            </button>
          </div>
          <QuoteEditor
            key={revise || epoch}
            data={data}
            quote={data.quotes.find((x) => x.id === revise)}
            run={run}
            busy={busy}
          />
        </section>
      )}
      <section className={panel}>
        <h2 className="text-lg font-black text-white">
          Ultimele 100 de oferte
        </h2>
        {!data.quotes.length ? (
          <p className="mt-3 text-slate-300">
            Nu există oferte în portofoliul autorizat.
          </p>
        ) : (
          <div className="mt-3 grid min-w-0 gap-2">
            {data.quotes.map((quote) => (
              <button
                key={quote.id}
                type="button"
                className={`min-w-0 rounded-lg border p-3 text-left ${selected === quote.id ? "border-focus-yellow" : "border-focus-line"}`}
                onClick={() => {
                  setSelected(quote.id);
                  setVersionId(null);
                  setAcceptanceKey(uuid());
                  setDraftKey(uuid());
                }}
              >
                <strong className="block break-words text-white">
                  {quote.revisions[0]?.payload.clientName} ·{" "}
                  {quote.revisions[0]?.payload.campaignName}
                </strong>
                <span className="text-sm text-slate-300">
                  v{quote.latestRevision} · {status(quote.state)} ·{" "}
                  {quote.revisions[0]?.payload.totals.gross}{" "}
                  {quote.revisions[0]?.payload.currency}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      {q && revision && (
        <section className={panel}>
          <div className="flex flex-wrap justify-between gap-3">
            <h2 className="text-lg font-black text-white">
              {revision.payload.clientName} · versiunea {revision.revision}
            </h2>
            {data.permissions.write && (
              <button
                type="button"
                className="focus-button secondary"
                onClick={() => setRevise(q.id)}
              >
                Pregătește o versiune nouă
              </button>
            )}
          </div>
          <p className="mt-2 break-words text-sm text-slate-300">
            Destinatar exact: {revision.payload.recipient} · Campanie:{" "}
            {revision.payload.campaignName} · Valabilă până la{" "}
            {date(revision.expiresAt)}
          </p>
          <p className="mt-2 text-white">
            {revision.payload.periodStart} – {revision.payload.periodEnd},
            ultima zi inclusă · {revision.payload.companyEntity}
          </p>
          <div
            className="mt-3 max-w-full overflow-x-auto"
            role="region"
            aria-label="Prețurile ofertei"
            tabIndex={0}
          >
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Cod</th>
                  <th className="p-2">Tarif lunar</th>
                  <th className="p-2">Net pe perioadă</th>
                  <th className="p-2">TVA</th>
                  <th className="p-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {revision.payload.lines.map((l) => (
                  <tr className="border-t border-focus-line" key={l.locationId}>
                    <td className="p-2">{l.code}</td>
                    <td className="p-2 whitespace-nowrap">{l.monthlyRate}</td>
                    <td className="p-2">{l.net}</td>
                    <td className="p-2">{l.tax}</td>
                    <td className="p-2">{l.gross}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 font-bold text-white">
            Net {revision.payload.totals.net} · TVA{" "}
            {revision.payload.totals.tax} · Total{" "}
            {revision.payload.totals.gross} {revision.payload.currency}
          </p>
          <p className="mt-1 text-sm text-slate-300">
            TVA {revision.payload.vatRateBps / 100}% (
            {revision.payload.vatTreatment}) · termen de plată{" "}
            {revision.payload.paymentTermDays ?? "nesetat"} zile.
            Disponibilitatea se verifică din nou la aprobare și executare.
          </p>
          {revision.payload.assumptions && (
            <p className="mt-3 break-words text-sm text-slate-300">
              Ipoteze de revizuit: {revision.payload.assumptions}
            </p>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer font-bold text-white">
              Integritate și versiuni
            </summary>
            <p className="mt-2 break-all font-mono text-xs text-slate-300">
              Hash: {revision.payloadHash}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {q.revisions.map((v) => (
                <button
                  type="button"
                  key={v.id}
                  className="focus-button secondary"
                  onClick={() => setVersionId(v.id)}
                >
                  v{v.revision} · {date(v.createdAt)}
                </button>
              ))}
            </div>
            <p className="mt-1 text-sm text-slate-300">
              Versiunile salvate sunt imuabile; o modificare creează o versiune
              și invalidează aprobările vechi.
            </p>
          </details>
          {data.permissions.write && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="focus-button"
                disabled={busy}
                onClick={() =>
                  void run("approval.request", {
                    revisionId: revision.id,
                    action: "send_quote",
                  })
                }
              >
                Cere aprobarea expedierii
              </button>
              <button
                type="button"
                className="focus-button secondary"
                disabled={
                  busy ||
                  !data.policy?.generationEnabled ||
                  !data.capabilities.generationConfigured
                }
                onClick={() =>
                  void run("quote.generate", {
                    revisionId: revision.id,
                    requestKey: draftKey,
                  })
                }
              >
                Generează introducere internă
              </button>
            </div>
          )}
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run("approval.request", {
                revisionId: revision.id,
                action: "create_hold",
                holdExpiresAt: new Date(
                  field(e.currentTarget, "holdExpiry"),
                ).toISOString(),
              });
            }}
          >
            <Field label="Expirare HOLD propusă, maximum 5 zile">
              <input
                required
                type="datetime-local"
                name="holdExpiry"
                className={inputClass}
              />
            </Field>
            <Submit busy={busy}>Cere aprobare HOLD</Submit>
          </form>
          <p className="mt-3 text-sm text-slate-300">
            Crearea HOLD și BOOKED nu rezultă automat din acceptarea ofertei.
          </p>
          <div className="mt-4 grid gap-3">
            {data.approvals
              .filter((a) => a.revisionId === revision.id)
              .map((a) => (
                <article
                  key={a.id}
                  className="rounded-lg border border-focus-line p-3"
                >
                  <strong className="text-white">
                    {a.action === "send_quote"
                      ? "Expediere ofertă"
                      : "Creare HOLD"}
                    : {status(a.state)}
                  </strong>
                  <p className="text-sm text-slate-300">
                    Aprobarea expiră {date(a.expiresAt)}
                    {a.holdExpiresAt
                      ? `; HOLD până la ${date(a.holdExpiresAt)}`
                      : ""}
                    .
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.permissions.manage && a.state === "pending" && (
                      <>
                        <button
                          type="button"
                          className="focus-button"
                          disabled={busy}
                          onClick={() =>
                            void run("approval.decide", {
                              approvalId: a.id,
                              decision: "approved",
                              reason:
                                "Am revizuit versiunea, termenii și destinatarul afișate.",
                            })
                          }
                        >
                          Aprob exact această versiune
                        </button>
                        <button
                          type="button"
                          className="focus-button secondary"
                          disabled={busy}
                          onClick={() =>
                            void run("approval.decide", {
                              approvalId: a.id,
                              decision: "rejected",
                              reason: "Respins la revizuire umană.",
                            })
                          }
                        >
                          Resping
                        </button>
                      </>
                    )}
                    {data.permissions.manage &&
                      a.state === "approved" &&
                      a.action === "create_hold" &&
                      !a.principalId && (
                        <button
                          type="button"
                          className="focus-button"
                          disabled={busy}
                          onClick={() =>
                            void run("hold.execute", { approvalId: a.id })
                          }
                        >
                          Execută HOLD aprobat
                        </button>
                      )}
                    {data.permissions.write &&
                      a.state === "approved" &&
                      a.action === "send_quote" && (
                        <button
                          type="button"
                          className="focus-button secondary"
                          disabled={busy}
                          onClick={() =>
                            void run("dispatch.queue", { approvalId: a.id })
                          }
                        >
                          Pune în coada de expediere
                        </button>
                      )}
                  </div>
                </article>
              ))}
          </div>
          {data.permissions.write && (
            <form
              className="mt-5 grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const f = event.currentTarget;
                void run("quote.acceptance", {
                  revisionId: revision.id,
                  decision: field(f, "decision"),
                  evidenceReference: field(f, "evidence"),
                  ...(field(f, "document")
                    ? { documentId: field(f, "document") }
                    : {}),
                  requestKey: acceptanceKey,
                });
              }}
              onChange={() => setAcceptanceKey(uuid())}
            >
              <h3 className="font-black text-white sm:col-span-2">
                Decizia clientului cu dovadă
              </h3>
              <Field label="Decizie">
                <select className={inputClass} name="decision">
                  <option value="accepted">Acceptă această versiune</option>
                  <option value="rejected">Respinge această versiune</option>
                </select>
              </Field>
              <Field label="Referință a acceptării sau contractului">
                <input
                  required
                  minLength={5}
                  maxLength={500}
                  className={inputClass}
                  name="evidence"
                  placeholder="Contract semnat, mesaj sau document verificat"
                />
              </Field>
              <Field label="Document existent legat de dosar dacă există">
                <select name="document" className={inputClass}>
                  <option value="">
                    Fără document atașat, referință verificată manual
                  </option>
                  {data.documents
                    .filter(
                      (d) =>
                        d.clientId === revision.payload.clientId &&
                        (!d.campaignId ||
                          d.campaignId === revision.payload.campaignId),
                    )
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.fileName}
                      </option>
                    ))}
                </select>
              </Field>
              <Submit busy={busy}>Înregistrează decizia și dovada</Submit>
            </form>
          )}
          {data.acceptances
            .filter((a) => a.revisionId === revision.id)
            .map((a) => (
              <p className="mt-3 break-words text-sm text-slate-300" key={a.id}>
                {status(a.decision)} · {a.evidenceReference} ·{" "}
                {date(a.createdAt)}
              </p>
            ))}
          {data.dispatches
            .filter((d) => d.revisionId === revision.id)
            .map((d) => (
              <article
                key={d.id}
                className="mt-3 rounded border border-focus-line p-3"
              >
                <p className="break-words font-bold text-white">
                  {status(d.state)} · {d.recipient}
                </p>
                {d.providerReceipt && (
                  <p className="break-all text-xs text-slate-300">
                    Receipt: {d.providerReceipt}
                  </p>
                )}
                {d.state === "unknown" && (
                  <p className="text-sm text-slate-300">
                    Verifică furnizorul; nu repeta automat trimiterea.
                  </p>
                )}
                {data.permissions.manage && d.state === "queued" && (
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !data.policy?.outboundEnabled ||
                      !data.capabilities.outboundConfigured
                    }
                    className="focus-button mt-2"
                    onClick={() => void run("dispatch.process", { id: d.id })}
                  >
                    Expediază oferta aprobată
                  </button>
                )}
              </article>
            ))}
        </section>
      )}
    </>
  );
}

function QuoteEditor({
  data,
  quote,
  run,
  busy,
}: {
  data: Workspace;
  quote?: Quote;
  run: Run;
  busy: boolean;
}) {
  const old = quote?.revisions[0]?.payload;
  const [clientId, setClientId] = useState(old?.clientId || "");
  const [key] = useState(uuid);
  return (
    <form
      className="mt-4 grid min-w-0 gap-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = e.currentTarget;
        void run("quote.create", {
          ...(quote
            ? { quoteId: quote.id, expectedRevision: quote.latestRevision }
            : {}),
          clientId,
          campaignId: field(f, "campaignId"),
          recipient: field(f, "recipient"),
          companyEntity: field(f, "companyEntity"),
          periodStart: field(f, "periodStart"),
          periodEnd: field(f, "periodEnd"),
          locationIds: new FormData(f).getAll("locationIds").map(String),
          assumptions: field(f, "assumptions"),
          requestKey: key,
        });
      }}
    >
      <Field label="Client">
        <select
          required
          className={inputClass}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        >
          <option value="">Selectează clientul</option>
          {data.clients.map((x) => (
            <option key={x.id} value={x.id}>
              {x.companyName}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Campanie și monedă">
        <select
          required
          className={inputClass}
          name="campaignId"
          defaultValue={old?.campaignId || ""}
          key={clientId}
        >
          <option value="">Selectează campania</option>
          {data.campaigns
            .filter((x) => x.clientId === clientId)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.campaignName} · {x.currency || "monedă nesetată"}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Destinatarul exact pentru aprobare">
        <input
          type="email"
          required
          maxLength={254}
          className={inputClass}
          name="recipient"
          defaultValue={old?.recipient}
        />
      </Field>
      <Field label="Firma contractantă">
        <select
          name="companyEntity"
          className={inputClass}
          defaultValue={old?.companyEntity || ""}
          required
        >
          <option value="">Alege firma</option>
          <option>Focus Media</option>
          <option>Excellence Media</option>
          <option>Focus BG / Focus Media LLC EOOD</option>
        </select>
      </Field>
      <Field label="Prima zi inclusă">
        <input
          type="date"
          required
          className={inputClass}
          name="periodStart"
          defaultValue={old?.periodStart}
        />
      </Field>
      <Field label="Ultima zi inclusă">
        <input
          type="date"
          required
          className={inputClass}
          name="periodEnd"
          defaultValue={old?.periodEnd}
        />
      </Field>
      <Field label="Amplasamente statice din inventar">
        <select
          name="locationIds"
          required
          multiple
          size={6}
          className={inputClass}
          defaultValue={old?.lines.map((l) => l.locationId) || []}
        >
          {data.locations
            .filter(
              (x) =>
                !/digital|led|ecran|screen|lcd|display|dooh/i.test(
                  x.type || "",
                ),
            )
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} · {x.city || "oraș nesetat"} ·{" "}
                {x.rateCardValue ?? "preț lipsă"}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Ipoteze pentru revizuire">
        <textarea
          maxLength={2000}
          rows={6}
          name="assumptions"
          className={inputClass}
          defaultValue={old?.assumptions}
        />
      </Field>
      <p className="text-sm text-slate-300 md:col-span-2">
        Tarifele sunt recitite din inventar; moneda trebuie să corespundă
        politicii aprobate. TVA și totalurile se calculează pe server. O ofertă
        nu blochează inventarul. Pentru altă intenție folosește Ciornă nouă.
      </p>
      <Submit busy={busy}>Verifică și salvează versiunea</Submit>
    </form>
  );
}

function minutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
function Dooh({
  data,
  run,
  busy,
}: {
  data: Workspace;
  run: Run;
  busy: boolean;
}) {
  const [capacity, setCapacity] = useState<Capacity | null>(null),
    [bookingInput, setBookingInput] = useState<Record<string, unknown> | null>(
      null,
    ),
    [bookingKey, setBookingKey] = useState(uuid);
  return (
    <>
      <section className={panel}>
        <h2 className="text-lg font-black text-white">
          Inventar digital verificat
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          Capacitatea este cotă din buclă, nu ocupare exclusivă statică.
          Intervalele de difuzare sunt momente exacte cu capăt final exclus.
          Daypart-ul este exprimat în fusul profilului. Dovada foto de montaj nu
          ține loc de proof-of-play.
        </p>
        {data.profiles.length ? (
          data.profiles.map((p) => (
            <article
              key={p.id}
              className="mt-3 rounded-lg border border-focus-line p-3"
            >
              <strong className="text-white">
                {data.locations.find((l) => l.id === p.locationId)?.code ||
                  p.locationId}{" "}
                · {status(p.state)}
              </strong>
              <p className="text-sm text-slate-300">
                {p.timezone} · buclă {p.loopSeconds}s · spot {p.slotSeconds}s ·
                sursă {p.sourceReference}
              </p>
            </article>
          ))
        ) : (
          <p className="mt-3 text-slate-300">
            Nu există profiluri de capacitate. Eticheta DOOH singură nu
            dovedește capacitate vandabilă.
          </p>
        )}
      </section>
      {data.permissions.manage && (
        <section className={panel}>
          <h2 className="text-lg font-black text-white">
            Profil digital și sursa verificării
          </h2>
          <form
            className="mt-3 grid gap-3 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              void run("dooh.profile", {
                locationId: field(f, "locationId"),
                timezone: field(f, "timezone"),
                loopSeconds: numberField(f, "loop"),
                slotSeconds: numberField(f, "slot"),
                state: field(f, "state"),
                sourceReference: field(f, "source"),
              });
            }}
          >
            <Field label="Amplasament digital">
              <select required name="locationId" className={inputClass}>
                <option value="">Selectează</option>
                {data.locations
                  .filter((l) =>
                    /digital|led|ecran|screen|lcd|display|dooh/i.test(
                      l.type || "",
                    ),
                  )
                  .map((l) => (
                    <option value={l.id} key={l.id}>
                      {l.code}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Fus orar IANA">
              <input
                required
                name="timezone"
                defaultValue="Europe/Bucharest"
                className={inputClass}
              />
            </Field>
            <Field label="Durată buclă secunde">
              <input
                required
                type="number"
                name="loop"
                min={1}
                max={3600}
                className={inputClass}
              />
            </Field>
            <Field label="Durată spot secunde">
              <input
                required
                type="number"
                name="slot"
                min={1}
                max={600}
                className={inputClass}
              />
            </Field>
            <Field label="Sursă contractuală sau tehnică">
              <input
                required
                minLength={5}
                maxLength={500}
                name="source"
                className={inputClass}
              />
            </Field>
            <Field label="Starea verificării">
              <select name="state" className={inputClass}>
                <option value="draft">Ciornă neutilizabilă la alocare</option>
                <option value="verified">
                  Am verificat capacitatea și sursa
                </option>
              </select>
            </Field>
            <Submit busy={busy}>Salvează profilul</Submit>
          </form>
        </section>
      )}
      <section className={panel}>
        <h2 className="text-lg font-black text-white">
          Verifică o fereastră de difuzare
        </h2>
        <form
          className="mt-3 grid gap-3 md:grid-cols-2"
          onChange={() => setCapacity(null)}
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const c = {
              profileId: field(f, "profile"),
              periodStart: new Date(field(f, "from")).toISOString(),
              periodEnd: new Date(field(f, "to")).toISOString(),
              daypartStartMinute: minutes(field(f, "startMinute")),
              daypartEndMinute: minutes(field(f, "endMinute")),
              shareBps: Math.round(numberField(f, "share") * 100),
            };
            const payload = {
              capacity: c,
              campaignId: field(f, "campaign"),
              approvalReference: field(f, "approval"),
            };
            void run("dooh.check", c).then((r) => {
              if (r) {
                setCapacity(r as Capacity);
                setBookingInput(payload);
                setBookingKey(uuid());
              }
            });
          }}
        >
          <Field label="Profil verificat">
            <select required name="profile" className={inputClass}>
              <option value="">Selectează</option>
              {data.profiles
                .filter((p) => p.state === "verified")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {data.locations.find((l) => l.id === p.locationId)?.code ||
                      p.locationId}{" "}
                    · {p.timezone}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Cotă solicitată procente">
            <input
              required
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              name="share"
              className={inputClass}
            />
          </Field>
          <Field
            label={`Început în fusul browserului (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
          >
            <input
              required
              type="datetime-local"
              name="from"
              className={inputClass}
            />
          </Field>
          <Field label="Sfârșit exclus în același fus">
            <input
              required
              type="datetime-local"
              name="to"
              className={inputClass}
            />
          </Field>
          <Field label="Daypart început în fusul profilului">
            <input
              required
              pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
              name="startMinute"
              defaultValue="00:00"
              className={inputClass}
            />
          </Field>
          <Field label="Daypart sfârșit exclus 24:00 pentru zi completă">
            <input
              required
              pattern="(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00)"
              name="endMinute"
              defaultValue="24:00"
              className={inputClass}
            />
          </Field>
          {data.permissions.manage && (
            <>
              <Field label="Campanie pentru eventuala alocare">
                <select name="campaign" className={inputClass}>
                  <option value="">Selectează la alocare</option>
                  {data.campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.campaignName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Referință de aprobare comercială">
                <input
                  name="approval"
                  maxLength={500}
                  className={inputClass}
                  placeholder="Contract sau aprobare verificată"
                />
              </Field>
            </>
          )}
          <Submit busy={busy}>Verifică fără alocare</Submit>
        </form>
        {capacity && (
          <div
            role="status"
            className="mt-4 rounded border border-focus-line p-3"
          >
            <p className="font-bold text-white">
              {capacity.available
                ? "Capacitate suficientă acum"
                : "Capacitate insuficientă"}
              : liber {(capacity.remainingBps / 100).toFixed(2)}%
            </p>
            <p className="mt-1 text-sm text-slate-300">
              {date(capacity.periodStart)} – {date(capacity.periodEnd)} ·{" "}
              {capacity.timezone} · verificare valabilă până la{" "}
              {date(capacity.validUntil)}. Nu reprezintă o alocare.
            </p>
            {data.permissions.manage && (
              <button
                type="button"
                className="focus-button mt-3"
                disabled={busy || !capacity.available}
                onClick={() =>
                  void run("dooh.book", {
                    ...bookingInput,
                    expectedSnapshot: capacity.snapshotHash,
                    requestKey: bookingKey,
                  })
                }
              >
                Confirm alocarea verificată
              </button>
            )}
          </div>
        )}
      </section>
      <section className={panel}>
        <h2 className="text-lg font-black text-white">
          Alocări și dovezi de difuzare
        </h2>
        {data.doohBookings.length ? (
          data.doohBookings.map((b) => (
            <article
              key={b.id}
              className="mt-3 rounded border border-focus-line p-3"
            >
              <p className="font-bold text-white">
                {data.campaigns.find((c) => c.id === b.campaignId)
                  ?.campaignName || "Campanie autorizată"}{" "}
                · {b.shareBps / 100}% · {status(b.state)}
              </p>
              <p className="text-sm text-slate-300">
                {date(b.periodStart)} – {date(b.periodEnd)}
              </p>
              {data.permissions.manage && b.state === "confirmed" && (
                <button
                  type="button"
                  className="focus-button secondary mt-2"
                  disabled={busy}
                  onClick={() => void run("dooh.cancel", { id: b.id })}
                >
                  Retrage alocarea
                </button>
              )}
            </article>
          ))
        ) : (
          <p className="mt-3 text-slate-300">
            Nu există alocări în portofoliu.
          </p>
        )}
        {data.playbackProofs?.map((p) => (
          <p key={p.id} className="mt-3 break-words text-sm text-slate-300">
            Dovadă verificată: {p.actualPlays} /{" "}
            {p.expectedPlays ?? "necunoscut"} difuzări · {p.sourceReference} ·{" "}
            {date(p.periodStart)} – {date(p.periodEnd)}
          </p>
        ))}
        {data.permissions.manage && (
          <form
            className="mt-4 grid gap-3 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              void run("dooh.proof", {
                bookingId: field(f, "booking"),
                periodStart: new Date(field(f, "from")).toISOString(),
                periodEnd: new Date(field(f, "to")).toISOString(),
                actualPlays: numberField(f, "actual"),
                ...(field(f, "expected")
                  ? { expectedPlays: numberField(f, "expected") }
                  : {}),
                sourceReference: field(f, "source"),
                evidenceHash: field(f, "hash"),
              });
            }}
          >
            <h3 className="font-black text-white md:col-span-2">
              Înregistrează o dovadă verificată manual
            </h3>
            <Field label="Alocare">
              <select name="booking" required className={inputClass}>
                <option value="">Selectează</option>
                {data.doohBookings.map((b) => (
                  <option value={b.id} key={b.id}>
                    {
                      data.campaigns.find((c) => c.id === b.campaignId)
                        ?.campaignName
                    }{" "}
                    · {b.shareBps / 100}% · {date(b.periodStart)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Referință raport de player sau document">
              <input
                required
                minLength={5}
                maxLength={500}
                name="source"
                className={inputClass}
              />
            </Field>
            <Field label="Început dovadă în fusul browserului">
              <input
                type="datetime-local"
                required
                name="from"
                className={inputClass}
              />
            </Field>
            <Field label="Sfârșit dovadă">
              <input
                type="datetime-local"
                required
                name="to"
                className={inputClass}
              />
            </Field>
            <Field label="Difuzări efective verificate">
              <input
                type="number"
                required
                min={0}
                name="actual"
                className={inputClass}
              />
            </Field>
            <Field label="Difuzări așteptate dacă există sursă">
              <input
                type="number"
                min={0}
                name="expected"
                className={inputClass}
              />
            </Field>
            <Field label="SHA256 al dovezii originale">
              <input
                required
                pattern="[a-f0-9]{64}"
                name="hash"
                className={inputClass}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input required type="checkbox" />
              Confirm că am verificat sursa și intervalul.
            </label>
            <Submit busy={busy}>Înregistrează proof of play</Submit>
          </form>
        )}
      </section>
    </>
  );
}

const scopeLabels: Record<string, string> = {
  "inventory.search": "Caută inventar autorizat",
  "availability.check": "Verifică disponibilitate",
  "opportunity.read": "Citește oportunități proprii",
  "quote.draft": "Pregătește ciornă de ofertă",
  "approval.request": "Cere aprobare umană",
  "hold.execute": "Execută exclusiv HOLD aprobat de om",
  "receipt.read": "Citește rezultatul propriei comenzi",
};
function Ai({ data, run, busy }: { data: Workspace; run: Run; busy: boolean }) {
  const [pilotId, setPilotId] = useState(""),
    [report, setReport] = useState<PilotReport | null>(null),
    [reportError, setReportError] = useState<string | null>(null),
    [reportLoading, setReportLoading] = useState(false);
  async function refreshReport(id: string) {
    setPilotId(id);
    setReportLoading(true);
    setReportError(null);
    try {
      const response = await fetch(
        "/api/admin/commercial-workbench?pilotId=" + encodeURIComponent(id),
        { cache: "no-store" },
      );
      const value = await response.json();
      if (!response.ok)
        throw new Error(
          value.error || "Raportul pilotului nu poate fi încărcat.",
        );
      setReport(value);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Raport indisponibil.");
      setReport(null);
    } finally {
      setReportLoading(false);
    }
  }
  const p = data.policy;
  return (
    <>
      <section className={panel}>
        <h2 className="text-lg font-black text-white">Stare și limite</h2>
        <ul className="mt-3 grid gap-2 text-sm text-slate-300">
          <li>
            Instrumente delegate:{" "}
            {p?.agentToolsEnabled
              ? "permise numai prin token și scope"
              : "oprite"}
            .
          </li>
          <li>
            Generare internă:{" "}
            {p?.generationEnabled && data.capabilities.generationConfigured
              ? "configurată; fiecare apel cere acțiune umană"
              : "oprită sau neconfigurată"}
            .
          </li>
          <li>
            Expedieri comerciale:{" "}
            {p?.outboundEnabled && data.capabilities.outboundConfigured
              ? "conector configurat; aprobare exactă și execuție umană obligatorii"
              : "oprite sau neconfigurate"}
            .
          </li>
          <li>
            Agentul nu poate confirma BOOKED, înregistra plăți, schimba roluri
            sau executa SQL/URL-uri arbitrare.
          </li>
          <li>
            Textele CRM și documentele sunt date neîncrezătoare; nu pot acorda
            permisiuni.
          </li>
        </ul>
        {data.permissions.configure && p && (
          <button
            type="button"
            className="focus-button secondary mt-4"
            disabled={busy}
            onClick={() => void run("policy.stopAll", {})}
          >
            Oprește instrumentele AI, generarea și expedierile
          </button>
        )}
      </section>
      {data.permissions.configure && (
        <details className={panel} open={!p}>
          <summary className="cursor-pointer text-lg font-black text-white">
            Politica comercială aprobată
          </summary>
          <p className="mt-2 text-sm text-slate-300">
            Completează valorile fiscale și moneda reală a tarifelor. Salvarea
            unei noi versiuni invalidează aprobările bazate pe politica veche.
            Nu activa furnizori sau canale până când datele, costurile și
            dreptul de contact sunt aprobate.
          </p>
          <form
            className="mt-3 grid gap-3 md:grid-cols-2"
            key={p?.version || "new"}
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              void run("policy.save", {
                vatRateBps: Math.round(numberField(f, "vat") * 100),
                vatTreatment: field(f, "vatTreatment"),
                rateCardCurrency: field(f, "currency"),
                quoteValidityDays: numberField(f, "validity"),
                approvalHours: numberField(f, "approvalHours"),
                maxDailyModelCalls: numberField(f, "modelCalls"),
                agentToolsEnabled: new FormData(f).has("tools"),
                generationEnabled: new FormData(f).has("generation"),
                outboundEnabled: new FormData(f).has("outbound"),
              });
            }}
          >
            <Field label="Cota TVA validată procente">
              <input
                required
                type="number"
                min="0"
                max="100"
                step="0.01"
                name="vat"
                defaultValue={p ? p.vatRateBps / 100 : undefined}
                className={inputClass}
              />
            </Field>
            <Field label="Tratament TVA">
              <select
                name="vatTreatment"
                defaultValue={p?.vatTreatment || ""}
                required
                className={inputClass}
              >
                <option value="">Selectează tratamentul</option>
                <option value="exclusive">TVA adăugat la net</option>
                <option value="inclusive">Tariful include TVA</option>
                <option value="exempt">Scutit cu rată zero</option>
              </select>
            </Field>
            <Field label="Moneda tarifelor numerice din inventar">
              <select
                name="currency"
                defaultValue={p?.rateCardCurrency || ""}
                required
                className={inputClass}
              >
                <option value="">Selectează moneda verificată</option>
                <option>EUR</option>
                <option>RON</option>
              </select>
            </Field>
            <Field label="Valabilitate ofertă zile">
              <input
                required
                name="validity"
                type="number"
                min={1}
                max={30}
                defaultValue={p?.quoteValidityDays || 7}
                className={inputClass}
              />
            </Field>
            <Field label="Valabilitate aprobare ore">
              <input
                required
                name="approvalHours"
                type="number"
                min={1}
                max={72}
                defaultValue={p?.approvalHours || 24}
                className={inputClass}
              />
            </Field>
            <Field label="Apeluri model maxime pe persoană pe zi">
              <input
                required
                name="modelCalls"
                type="number"
                min={1}
                max={100}
                defaultValue={p?.maxDailyModelCalls || 20}
                className={inputClass}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                name="tools"
                defaultChecked={p?.agentToolsEnabled || false}
              />
              Activez instrumentele pentru delegările aprobate
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                name="generation"
                defaultChecked={p?.generationEnabled || false}
              />
              Aprob generarea internă pe datele minimizate
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
              <input
                type="checkbox"
                name="outbound"
                defaultChecked={p?.outboundEnabled || false}
              />
              Aprob folosirea canalului comercial configurat, cu aprobare
              individuală și execuție umană
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
              <input required type="checkbox" />
              Am verificat TVA, moneda, prețurile și regulile de utilizare a
              datelor.
            </label>
            <Submit busy={busy}>Aprob și salvez politica</Submit>
          </form>
        </details>
      )}
      {data.permissions.manage && (
        <>
          <section className={panel}>
            <h2 className="text-lg font-black text-white">
              Delegare pentru o integrare
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Principal separat, token cu expirare și portofoliul unui seller
              activ. Shadow permite numai citiri. Copilot poate salva ciorne și
              cere aprobări, fără efect comercial extern autonom.
            </p>
            <form
              className="mt-3 grid gap-3 md:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                void run("principal.issue", {
                  name: field(f, "name"),
                  ownerUserId: field(f, "owner"),
                  mode: field(f, "mode"),
                  maxDailyCommands: numberField(f, "commands"),
                  expiresAt: new Date(field(f, "expiry")).toISOString(),
                  scopes: new FormData(f).getAll("scope").map(String),
                });
              }}
            >
              <Field label="Denumire integrare">
                <input
                  name="name"
                  required
                  minLength={3}
                  maxLength={120}
                  className={inputClass}
                />
              </Field>
              <Field label="Portofoliu delegat">
                <select name="owner" required className={inputClass}>
                  <option value="">Selectează sellerul</option>
                  {data.delegatableOwners?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} · {o.role}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Mod de lucru">
                <select name="mode" className={inputClass}>
                  <option value="shadow">Shadow numai citire</option>
                  <option value="copilot">
                    Copilot ciorne și cereri de aprobare
                  </option>
                </select>
              </Field>
              <Field label="Comenzi maxime pe zi">
                <input
                  name="commands"
                  type="number"
                  required
                  min={1}
                  max={1000}
                  defaultValue={100}
                  className={inputClass}
                />
              </Field>
              <Field label="Expirare în maximum 31 de zile în fusul browserului">
                <input
                  name="expiry"
                  type="datetime-local"
                  required
                  className={inputClass}
                />
              </Field>
              <fieldset className="grid gap-2 rounded border border-focus-line p-3">
                <legend className="px-1 text-sm font-bold text-white">
                  Instrumente permise explicit
                </legend>
                {Object.entries(scopeLabels).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-sm text-slate-300"
                  >
                    <input
                      type="checkbox"
                      name="scope"
                      value={key}
                      defaultChecked={
                        key === "inventory.search" ||
                        key === "availability.check" ||
                        key === "receipt.read"
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <Submit busy={busy}>Emite tokenul o singură dată</Submit>
            </form>
            <div className="mt-4 grid gap-2">
              {data.principals.map((a) => (
                <article
                  key={a.id}
                  className="rounded border border-focus-line p-3"
                >
                  <strong className="text-white">{a.name}</strong>
                  <p className="break-words text-sm text-slate-300">
                    {a.mode} ·{" "}
                    {a.revokedAt
                      ? "Revocat"
                      : "Valabil până la " + date(a.expiresAt)}{" "}
                    · {a.scopes.map((s) => scopeLabels[s] || s).join(", ")}
                  </p>
                  {!a.revokedAt && (
                    <button
                      type="button"
                      className="focus-button secondary mt-2"
                      disabled={busy}
                      onClick={() => void run("principal.revoke", { id: a.id })}
                    >
                      Revocă delegarea
                    </button>
                  )}
                </article>
              ))}
            </div>
          </section>
          <section className={panel}>
            <h2 className="text-lg font-black text-white">
              Protocol de pilot preregistrat
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Compară sellerul singur cu sellerul asistat. Alocarea este stabilă
              la nivel de companie; rezultatele nematurizate nu sunt conversii
              finale. Un pilot nou nu trimite mesaje și nu înlocuiește automat
              sellerul.
            </p>
            <form
              className="mt-3 grid gap-3 md:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                void run("pilot.create", {
                  name: field(f, "name"),
                  mode: field(f, "mode"),
                  protocol: {
                    objective: field(f, "objective"),
                    eligibility: field(f, "eligibility"),
                    maturityDays: numberField(f, "maturity"),
                    targetCasesPerArm: numberField(f, "target"),
                    minimumSourcePrecision: numberField(f, "precision") / 100,
                    maximumModelCostPerCase: numberField(f, "cost"),
                    costCurrency: field(f, "currency"),
                    permittedData: field(f, "data"),
                    channels: "none",
                    humanApprovalAtEveryCommercialEffect: true,
                  },
                });
              }}
            >
              <Field label="Denumire pilot">
                <input
                  name="name"
                  required
                  minLength={3}
                  maxLength={160}
                  className={inputClass}
                />
              </Field>
              <Field label="Fază">
                <select name="mode" className={inputClass}>
                  <option value="offline">Evaluare offline</option>
                  <option value="shadow">Shadow fără efecte</option>
                  <option value="copilot">Copilot cu om la efecte</option>
                </select>
              </Field>
              <Field label="Obiectiv măsurabil">
                <textarea
                  name="objective"
                  required
                  minLength={10}
                  maxLength={1000}
                  className={inputClass}
                  rows={3}
                />
              </Field>
              <Field label="Criterii de eligibilitate și cohorte">
                <textarea
                  name="eligibility"
                  required
                  minLength={10}
                  maxLength={2000}
                  className={inputClass}
                  rows={3}
                />
              </Field>
              <Field label="Fereastră de maturizare zile">
                <input
                  name="maturity"
                  type="number"
                  required
                  min={1}
                  max={365}
                  className={inputClass}
                />
              </Field>
              <Field label="Cazuri mature țintă pe braț">
                <input
                  name="target"
                  type="number"
                  required
                  min={10}
                  max={100000}
                  className={inputClass}
                />
              </Field>
              <Field label="Afirmații susținute de surse minim procente">
                <input
                  name="precision"
                  type="number"
                  required
                  min={90}
                  max={100}
                  step={0.1}
                  defaultValue={99}
                  className={inputClass}
                />
              </Field>
              <Field label="Cost model maxim pe caz">
                <input
                  name="cost"
                  type="number"
                  required
                  min={0}
                  max={10000}
                  step={0.01}
                  className={inputClass}
                />
              </Field>
              <Field label="Moneda evaluării costurilor">
                <select name="currency" className={inputClass}>
                  <option>EUR</option>
                  <option>RON</option>
                </select>
              </Field>
              <Field label="Date permise și minimizare">
                <textarea
                  name="data"
                  required
                  minLength={10}
                  maxLength={2000}
                  rows={3}
                  className={inputClass}
                />
              </Field>
              <Submit busy={busy}>Salvează protocolul fără activare</Submit>
            </form>
            <div className="mt-4 grid gap-3">
              {data.pilots.map((p) => (
                <article
                  key={p.id}
                  className="rounded border border-focus-line p-3"
                >
                  <strong className="text-white">
                    {p.name} · {status(p.state)} · {p.mode}
                  </strong>
                  <p className="mt-1 text-sm text-slate-300">
                    {p.protocol.objective}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="focus-button secondary"
                      disabled={busy || reportLoading}
                      onClick={() => void refreshReport(p.id)}
                    >
                      Vezi cazurile și rezultatele
                    </button>
                    {p.state === "draft" && (
                      <button
                        type="button"
                        className="focus-button"
                        disabled={busy}
                        onClick={() =>
                          void run("pilot.decide", {
                            pilotId: p.id,
                            action: "activate",
                            expectedProtocolHash: p.protocolHash,
                            reason:
                              "Protocolul și criteriile au fost revizuite și aprobate de responsabilul uman.",
                          })
                        }
                      >
                        Aprob și activez acest protocol
                      </button>
                    )}
                    {p.state === "active" && (
                      <button
                        type="button"
                        className="focus-button secondary"
                        disabled={busy}
                        onClick={() =>
                          void run("pilot.decide", {
                            pilotId: p.id,
                            action: "stop",
                            expectedProtocolHash: p.protocolHash,
                            reason:
                              "Oprire solicitată de responsabilul uman; delegările se revocă.",
                          })
                        }
                      >
                        Oprește pilotul și delegările
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
          {reportLoading && (
            <p role="status" className={panel}>
              Se încarcă rezultatele pilotului…
            </p>
          )}
          {reportError && (
            <p role="alert" className={panel}>
              {reportError}
            </p>
          )}
          {report && (
            <section className={panel}>
              <h2 className="text-lg font-black text-white">
                {report.pilot.name} rezultate observate
              </h2>
              <ul className="my-3 grid gap-1 text-sm text-slate-300">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <div className="grid gap-3 md:grid-cols-2">
                {report.arms.map((a) => (
                  <article
                    className="rounded border border-focus-line p-3"
                    key={a.arm}
                  >
                    <h3 className="font-black text-white">
                      {a.arm === "human" ? "Seller singur" : "Seller asistat"}
                    </h3>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-300">
                      <dt>Înscriși / maturi</dt>
                      <dd>
                        {a.enrolled} / {a.mature}
                      </dd>
                      <dt>BOOKED matur</dt>
                      <dd>{a.booked}</dd>
                      <dt>Încasări raportate</dt>
                      <dd>{a.paidAmount}</dd>
                      <dt>Marjă confirmată de evaluator</dt>
                      <dd>{a.verifiedMargin ?? "Incompletă"}</dd>
                      <dt>Minute om cu rework</dt>
                      <dd>{a.humanMinutes}</dd>
                      <dt>Cost model raportat</dt>
                      <dd>{a.modelCost}</dd>
                      <dt>Afirmații susținute</dt>
                      <dd>
                        {a.sourcePrecision === null
                          ? "Neevaluat"
                          : (a.sourcePrecision * 100).toFixed(1) + "%"}
                      </dd>
                      <dt>Oprire obligatorie</dt>
                      <dd>
                        {a.stopRequired
                          ? "Da"
                          : "Nu rezultă din cazurile introduse"}
                      </dd>
                    </dl>
                    {a.zeroEventUpper95Approx !== null && (
                      <p className="mt-2 text-xs text-slate-300">
                        Zero incidente observate nu înseamnă risc zero: limită
                        superioară aproximativă95%{" "}
                        {(a.zeroEventUpper95Approx * 100).toFixed(1)}%.
                      </p>
                    )}
                  </article>
                ))}
              </div>
              {report.pilot.state === "active" && (
                <form
                  className="mt-4 grid gap-3 md:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    void run("pilot.enroll", {
                      pilotId,
                      companyKey: field(f, "company"),
                      ...(field(f, "opportunity")
                        ? { opportunityId: field(f, "opportunity") }
                        : {}),
                    }).then((r) => {
                      if (r) void refreshReport(pilotId);
                    });
                  }}
                >
                  <h3 className="font-black text-white md:col-span-2">
                    Înscrie o companie eligibilă
                  </h3>
                  <Field label="Cheie stabilă de companie normalizată">
                    <input
                      name="company"
                      required
                      minLength={3}
                      maxLength={191}
                      className={inputClass}
                      placeholder="CUI sau ID stabil din setul aprobat"
                    />
                  </Field>
                  <Field label="Oportunitate dacă există">
                    <select name="opportunity" className={inputClass}>
                      <option value="">
                        Caz offline fără oportunitate reală
                      </option>
                      {data.opportunities.map((o) => (
                        <option value={o.id} key={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Submit busy={busy}>
                    Alocă determinist compania unui braț
                  </Submit>
                </form>
              )}
              <div className="mt-4 grid gap-3">
                {report.cases.map((c) => (
                  <CaseReview
                    key={c.id}
                    entry={c}
                    run={run}
                    busy={busy}
                    onSaved={() => void refreshReport(pilotId)}
                  />
                ))}
              </div>
            </section>
          )}
          <section className={panel}>
            <h2 className="text-lg font-black text-white">
              Istoric de execuție fără secrete
            </h2>
            {data.commandTraces?.length ? (
              <div className="mt-3 grid gap-2">
                {data.commandTraces.map((c) => (
                  <article
                    key={c.id}
                    className="rounded border border-focus-line p-3"
                  >
                    <strong className="text-white">
                      {c.tool} · {status(c.status)} · {date(c.createdAt)}
                    </strong>
                    <p className="mt-1 break-all text-xs text-slate-300">
                      Receipt {c.id} · Politică {c.policyVersion} · Request{" "}
                      {c.requestId}
                    </p>
                    <details className="mt-2 text-xs text-slate-300">
                      <summary className="cursor-pointer">
                        Hash-uri și consum
                      </summary>
                      <p className="break-all">
                        Input {c.inputHash}
                        <br />
                        Output {c.outputHash || "Fără rezultat confirmat"}
                        <br />
                        Tokenuri model {c.tokenCount ?? "nu se aplică"}
                      </p>
                    </details>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-slate-300">
                Nu există execuții. Nu se afișează rezultate simulate drept
                rezultate reale.
              </p>
            )}
          </section>
          <form
            className={panel + " grid gap-3 md:grid-cols-2"}
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              void run("recipient.suppress", {
                recipient: field(f, "recipient"),
                reason: field(f, "reason"),
              });
            }}
          >
            <h2 className="text-lg font-black text-white md:col-span-2">
              Exclude un destinatar de la expedieri
            </h2>
            <Field label="E-mail">
              <input
                name="recipient"
                type="email"
                required
                className={inputClass}
              />
            </Field>
            <Field label="Motiv">
              <input
                name="reason"
                required
                minLength={3}
                maxLength={240}
                className={inputClass}
              />
            </Field>
            <Submit busy={busy}>Adaugă în lista de excludere</Submit>
          </form>
        </>
      )}
    </>
  );
}

function CaseReview({
  entry,
  run,
  busy,
  onSaved,
}: {
  entry: PilotCase;
  run: Run;
  busy: boolean;
  onSaved: () => void;
}) {
  const m = entry.metrics;
  return (
    <details className="min-w-0 rounded border border-focus-line p-3">
      <summary className="cursor-pointer break-words font-bold text-white">
        Companie {entry.companyKeyHash.slice(0, 12)} ·{" "}
        {entry.arm === "human" ? "seller singur" : "seller asistat"} · înscrisă{" "}
        {date(entry.enrolledAt)}
      </summary>
      <form
        className="mt-3 grid gap-3 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          void run("pilot.review", {
            caseId: entry.id,
            metrics: {
              humanMinutes: numberField(f, "humanMinutes"),
              reworkMinutes: numberField(f, "reworkMinutes"),
              modelCost: numberField(f, "modelCost"),
              validSources: numberField(f, "validSources"),
              totalClaims: numberField(f, "totalClaims"),
              calculationErrors: numberField(f, "calculationErrors"),
              unauthorizedEffects: numberField(f, "unauthorizedEffects"),
              availabilityErrors: numberField(f, "availabilityErrors"),
              booked: new FormData(f).has("booked"),
              paidAmount: numberField(f, "paidAmount"),
              verifiedMargin: field(f, "verifiedMargin")
                ? numberField(f, "verifiedMargin")
                : null,
              complaints: numberField(f, "complaints"),
            },
            matured: new FormData(f).has("matured"),
            evidenceReference: field(f, "evidence"),
          }).then((r) => {
            if (r) onSaved();
          });
        }}
      >
        {(
          [
            ["humanMinutes", "Minute om"],
            ["reworkMinutes", "Minute corectare"],
            ["modelCost", "Cost model cu dovadă"],
            ["validSources", "Afirmații susținute"],
            ["totalClaims", "Afirmații totale"],
            ["calculationErrors", "Erori de calcul"],
            ["unauthorizedEffects", "Efecte neautorizate"],
            ["availabilityErrors", "Promisiuni false de disponibilitate"],
            ["paidAmount", "Încasări confirmate"],
            ["verifiedMargin", "Marjă confirmată sau gol"],
            ["complaints", "Reclamații"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              name={key}
              type="number"
              required={key !== "verifiedMargin"}
              min={key === "verifiedMargin" ? undefined : 0}
              step={/Minutes|Cost|Amount|Margin/.test(key) ? "0.01" : "1"}
              defaultValue={m[key] === null ? "" : String(m[key])}
              className={inputClass}
            />
          </Field>
        ))}
        <Field label="Dovada evaluării și rezultatelor">
          <input
            name="evidence"
            required
            minLength={5}
            maxLength={500}
            defaultValue={entry.reviewEvidence || ""}
            className={inputClass}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" name="booked" defaultChecked={m.booked} />
          BOOKED confirmat din sursa comercială
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" name="matured" />
          Fereastra preregistrată este încheiată
        </label>
        <p className="text-sm text-slate-300 md:col-span-3">
          Valorile sunt confirmate de evaluator pe dovadă, nu presupuse din CRM
          WON. Un efect neautorizat sau o promisiune de disponibilitate falsă
          oprește pilotul și revocă delegările.
        </p>
        <Submit busy={busy}>Salvează evaluarea cu trasabilitate</Submit>
      </form>
    </details>
  );
}
