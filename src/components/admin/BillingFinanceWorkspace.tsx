"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Option = { id: string; label: string; detail?: string | null };
type Plan = {
  page: number;
  total: number;
  totalPages: number;
  items: Array<{
    id: string;
    campaignId?: string | null;
    campaign?: string | null;
    client: string;
    locationCode?: string;
    responsible: string;
    periodStart: string;
    periodEnd: string;
    invoiceDate: string;
    dueDate: string;
    amount: string;
    currency: string;
    companyEntity: string | null;
    status: string;
    linkedAmount: string;
    unlinkedAmount: string;
    invoiceReferences: Array<{ id: string; number: string | null }>;
  }>;
};
type Report = {
  campaign: {
    campaignName: string;
    startDate: string | null;
    endDate: string | null;
  };
  currency: string;
  revenueNet: string;
  approvedCostsNet: string;
  marginNet: string | null;
  dataQualityReasons: string[];
  sourceFingerprint: string;
  coverageApproved: boolean;
  allocations: Array<{
    id: string;
    invoiceNumber: string | null;
    netAmount: string;
    vatAmount: string;
    grossAmount: string;
  }>;
  costs: Array<{
    id: string;
    description: string;
    sourceReference: string;
    netAmount: string;
    status: string;
    version: number;
  }>;
};
const reasons: Record<string, string> = {
  NO_REVENUE_ALLOCATIONS: "Lipsesc alocările de venit",
  CAMPAIGN_PERIOD_MISSING: "Perioada campaniei nu este completă",
  COSTS_PENDING_APPROVAL: "Există costuri neverificate",
  ALLOCATED_INVOICE_INVALID:
    "O factură asociată este exclusă sau necesită verificare",
  UNALLOCATED_INVOICE_REVENUE: "Există venit facturat nealocat integral",
  FISCAL_DATA_UNVERIFIED: "Defalcarea fiscală necesită verificare",
  INVOICE_OVERALLOCATED_AFTER_ADJUSTMENT:
    "O stornare a redus factura sub alocările existente",
  COST_COVERAGE_NOT_CONFIRMED:
    "Completitudinea costurilor nu a fost confirmată pentru datele curente",
};
const field =
  "w-full rounded-lg border border-white/20 bg-[#071b2b] p-3 text-white";
const button =
  "rounded-lg border border-amber-400/40 px-4 py-2 text-amber-300 disabled:opacity-40";
const date = (value: string) =>
  new Date(value).toLocaleDateString("ro-RO", { timeZone: "UTC" });
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(body.error || "Operația a eșuat.", response.status);
  return body;
}

function SearchOption({
  type,
  label,
  value,
  onChange,
  clientId,
}: {
  type: "campaigns" | "receivables" | "fiscal_documents";
  label: string;
  value: string;
  onChange: (id: string) => void;
  clientId?: string;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Option[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ type, q: query, take: "30" });
      if (clientId) params.set("clientId", clientId);
      if (value) params.set("selectedId", value);
      requestJson(`/api/admin/receivables-workspace/options?${params}`)
        .then((body) => {
          if (live) {
            setItems(body.items);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, type, value, clientId]);
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        Caută {label}
        <input
          className={field}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nume sau număr"
        />
      </label>
      <label className="block text-sm">
        {label}
        <select
          required
          className={field}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Alege…</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
              {item.detail ? ` — ${item.detail}` : ""}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

export function BillingFinanceWorkspace({
  mode,
  canWrite,
  canApprove,
  entities,
}: {
  mode: "plan" | "allocations";
  canWrite: boolean;
  canApprove: boolean;
  entities: Array<{ id: string; legalName: string }>;
}) {
  const [campaignId, setCampaignId] = useState("");
  const [currency, setCurrency] = useState("RON");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [receivableId, setReceivableId] = useState("");
  const inFlight = useRef(false);
  const intent = useRef<{ signature: string; key: string } | null>(null);
  const loadVersion = useRef(0);
  const [allocation, setAllocation] = useState({
    netAmount: "",
    vatAmount: "",
    grossAmount: "",
    billingItemId: "",
    notes: "",
  });
  const [cost, setCost] = useState({
    netAmount: "",
    vatAmount: "",
    grossAmount: "",
    legalEntityId: entities[0]?.id || "",
    sourceReference: "",
    description: "",
    costType: "media",
  });
  const [tax, setTax] = useState({
    netAmount: "",
    vatAmount: "",
    evidenceReference: "",
  });
  const [taxDocumentId, setTaxDocumentId] = useState("");
  const [coverageNotes, setCoverageNotes] = useState("");
  async function refresh(page = 1) {
    const version = ++loadVersion.current;
    if (mode === "plan") {
      const data = await requestJson(
        `/api/admin/billing-plan?${new URLSearchParams({ ...(campaignId ? { campaignId } : {}), currency, page: String(page) })}`,
      );
      if (version === loadVersion.current) setPlan(data);
    } else if (campaignId) {
      const [data, billing] = await Promise.all([
        requestJson(
          `/api/admin/financial/campaign-finance?${new URLSearchParams({ campaignId, currency })}`,
        ),
        requestJson(
          `/api/admin/billing-plan?${new URLSearchParams({ campaignId, currency, page: String(page) })}`,
        ),
      ]);
      if (version === loadVersion.current) {
        setReport(data);
        setPlan(billing);
      }
    } else setReport(null);
  }
  useEffect(() => {
    setReport(null);
    setPlan(null);
    setError("");
    refresh().catch((e) => setError(e.message));
  }, [campaignId, currency, mode]); // Values are authoritative server filters.
  async function mutate(
    body: Record<string, unknown>,
    endpoint = "/api/admin/financial/campaign-finance",
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const needsKey =
        body.action === "allocate" || body.action === "create_cost";
      const signature = JSON.stringify(body);
      if (needsKey) {
        if (intent.current && intent.current.signature !== signature)
          throw new Error(
            "Rezultatul încercării anterioare este necunoscut. Reîncarcă raportul și verifică înregistrările înainte de o intenție nouă.",
          );
        intent.current ||= { signature, key: crypto.randomUUID() };
        body.requestKey = intent.current.key;
      }
      await requestJson(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      intent.current = null;
      if (body.action === "allocate")
        setAllocation({
          netAmount: "",
          vatAmount: "",
          grossAmount: "",
          billingItemId: "",
          notes: "",
        });
      if (body.action === "create_cost")
        setCost((current) => ({
          ...current,
          netAmount: "",
          vatAmount: "",
          grossAmount: "",
          description: "",
          sourceReference: "",
        }));
      setNotice("Operația a fost înregistrată. Datele au fost reîncărcate.");
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500)
        intent.current = null;
      setError(e instanceof Error ? e.message : "Operația a eșuat.");
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  const submit = (event: FormEvent, body: Record<string, unknown>) => {
    event.preventDefault();
    void mutate(body);
  };
  return (
    <main className="mx-auto max-w-[1500px] space-y-6 p-4 text-white md:p-8">
      <nav className="flex flex-wrap gap-4 text-amber-300">
        <Link href="/admin/financiar/incasari">Încasări</Link>
        <Link href="/admin/financiar/reconciliere">Reconciliere bancară</Link>
        <Link href="/admin/financiar/facturi-de-emis">Facturi de emis</Link>
        <Link href="/admin/financiar/alocari">Alocări și costuri</Link>
      </nav>
      <div>
        <h1 className="text-2xl font-bold">
          {mode === "plan"
            ? "Facturi de emis — plan intern"
            : "Alocări de facturi și costuri pe campanie"}
        </h1>
        <p className="mt-2 text-slate-300">
          Valorile contractuale sunt planificate net. TVA se preia explicit din
          documentul fiscal verificat. Factura fiscală se emite în sistemul
          contabil ales de companie.
        </p>
      </div>
      <div className="grid gap-4 rounded-xl border border-white/15 p-4 md:grid-cols-2">
        <SearchOption
          type="campaigns"
          label="campania"
          value={campaignId}
          onChange={setCampaignId}
        />
        <label>
          Monedă
          <select
            className={field}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option>RON</option>
            <option>EUR</option>
          </select>
        </label>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-400 p-4 text-red-200"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-emerald-200">
          {notice}
        </p>
      )}
      <button
        className={button}
        disabled={busy}
        onClick={() => {
          setError("");
          refresh(plan?.page).catch((e) => setError(e.message));
        }}
      >
        Reîncarcă datele
      </button>
      {mode === "plan" && (
        <>
          <button
            className={button}
            disabled={!canWrite || !campaignId || busy}
            onClick={() =>
              void mutate({ campaignId }, "/api/admin/billing-plan")
            }
          >
            Generează / reconciliază planul campaniei
          </button>
          <p className="text-sm text-slate-300">
            Generarea păstrează documentele asociate și istoricul. Datele lipsă
            sau termenii modificați pe poziții facturate necesită reconciliere
            explicită.
          </p>
          {!plan && !error && <p role="status">Se încarcă planul…</p>}
          {plan && (
            <>
              <p>{plan.total} obligații interne</p>
              <div className="overflow-x-auto rounded-xl border border-white/15">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead>
                    <tr>
                      {[
                        "Campanie / client / locație",
                        "Responsabil",
                        "Perioadă",
                        "Emitere / scadență",
                        "Net planificat",
                        "Net asociat / rămas",
                        "Stare / documente",
                      ].map((title) => (
                        <th key={title} className="p-3">
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.items.map((item) => (
                      <tr key={item.id} className="border-t border-white/10">
                        <td className="p-3">
                          {item.campaign}
                          <br />
                          {item.client}
                          <br />
                          {item.locationCode}
                          <br />
                          <span className="text-slate-400">
                            {item.companyEntity}
                          </span>
                        </td>
                        <td className="p-3">{item.responsible}</td>
                        <td className="p-3">
                          {date(item.periodStart)}–{date(item.periodEnd)}
                        </td>
                        <td className="p-3">
                          {date(item.invoiceDate)}
                          <br />
                          {date(item.dueDate)}
                        </td>
                        <td className="p-3">
                          {item.amount} {item.currency}
                        </td>
                        <td className="p-3">
                          {item.linkedAmount} / {item.unlinkedAmount}
                        </td>
                        <td className="p-3">
                          {item.status}
                          <br />
                          {item.invoiceReferences
                            .map((ref) => ref.number)
                            .join(", ")}
                          <br />
                          <Link
                            className="text-amber-300"
                            href="/admin/financiar/alocari"
                          >
                            Asociază document importat
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!plan.items.length && (
                <p>
                  Nicio obligație în filtrul curent. Alege o campanie cu
                  închirieri confirmate pentru generare.
                </p>
              )}
              <div className="flex gap-3">
                <button
                  className={button}
                  disabled={plan.page <= 1}
                  onClick={() =>
                    refresh(plan.page - 1).catch((e) => setError(e.message))
                  }
                >
                  Anterior
                </button>
                <span>
                  {plan.page}/{plan.totalPages}
                </span>
                <button
                  className={button}
                  disabled={plan.page >= plan.totalPages}
                  onClick={() =>
                    refresh(plan.page + 1).catch((e) => setError(e.message))
                  }
                >
                  Următor
                </button>
              </div>
            </>
          )}
        </>
      )}
      {mode === "allocations" && campaignId && !report && !error && (
        <p role="status">Se încarcă situația campaniei…</p>
      )}
      {mode === "allocations" && campaignId && report && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              ["Venit net alocat", report.revenueNet],
              ["Costuri nete aprobate", report.approvedCostsNet],
              ["Marjă verificată", report.marginNet ?? "Neconfirmată"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-white/15 p-4"
              >
                <p className="text-slate-300">{label}</p>
                <p className="text-xl font-bold">
                  {value} {report.currency}
                </p>
              </div>
            ))}
          </div>
          {!!report.dataQualityReasons.length && (
            <ul className="list-disc pl-5 text-amber-200">
              {report.dataQualityReasons.map((reason) => (
                <li key={reason}>{reasons[reason] || reason}</li>
              ))}
            </ul>
          )}
          <SearchOption
            type="receivables"
            label="factura fiscală importată"
            value={receivableId}
            onChange={setReceivableId}
          />
          {canWrite && (
            <form
              className="space-y-4 rounded-xl border border-white/15 p-4"
              onSubmit={(e) =>
                submit(e, {
                  action: "allocate",
                  campaignId,
                  receivableId,
                  currency,
                  ...allocation,
                  billingItemId: allocation.billingItemId || null,
                })
              }
            >
              <h2 className="text-lg font-bold">
                Asociază valoarea fiscală unei campanii
              </h2>
              <p className="text-sm text-slate-300">
                Pentru o factură cu mai multe campanii, adaugă separat fiecare
                parte. Sistemul verifică firma, clientul, moneda și capacitatea
                net/TVA/brut după storno.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                {(["netAmount", "vatAmount", "grossAmount"] as const).map(
                  (key) => (
                    <label key={key}>
                      {key === "netAmount"
                        ? "Net"
                        : key === "vatAmount"
                          ? "TVA"
                          : "Brut"}
                      <input
                        required
                        inputMode="decimal"
                        pattern="[0-9]+([.][0-9]{1,2})?"
                        className={field}
                        value={allocation[key]}
                        onChange={(e) =>
                          setAllocation({
                            ...allocation,
                            [key]: e.target.value,
                          })
                        }
                      />
                    </label>
                  ),
                )}
              </div>
              <label className="block">
                Poziția contractuală din plan (opțional)
                <select
                  className={field}
                  value={allocation.billingItemId}
                  onChange={(e) =>
                    setAllocation({
                      ...allocation,
                      billingItemId: e.target.value,
                    })
                  }
                >
                  <option value="">Fără asociere la plan</option>
                  {plan?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.locationCode} · {date(item.periodStart)}–
                      {date(item.periodEnd)} · rămas net {item.unlinkedAmount}{" "}
                      {item.currency}
                    </option>
                  ))}
                </select>
              </label>
              {plan && plan.totalPages > 1 && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className={button}
                    disabled={plan.page <= 1}
                    onClick={() =>
                      refresh(plan.page - 1).catch((e) => setError(e.message))
                    }
                  >
                    Poziții anterioare
                  </button>
                  <span>
                    {plan.page}/{plan.totalPages}
                  </span>
                  <button
                    type="button"
                    className={button}
                    disabled={plan.page >= plan.totalPages}
                    onClick={() =>
                      refresh(plan.page + 1).catch((e) => setError(e.message))
                    }
                  >
                    Poziții următoare
                  </button>
                </div>
              )}
              <label className="block">
                Notă
                <input
                  className={field}
                  value={allocation.notes}
                  onChange={(e) =>
                    setAllocation({ ...allocation, notes: e.target.value })
                  }
                />
              </label>
              <button className={button} disabled={busy || !receivableId}>
                Înregistrează alocarea
              </button>
            </form>
          )}
          {canApprove && (
            <form
              className="space-y-3 rounded-xl border border-white/15 p-4"
              onSubmit={(e) =>
                submit(e, {
                  action: "attest_tax",
                  receivableId: taxDocumentId,
                  ...tax,
                })
              }
            >
              <h2 className="font-bold">Verifică defalcarea fiscală lipsă</h2>
              <SearchOption
                type="fiscal_documents"
                label="documentul fiscal sau stornarea"
                value={taxDocumentId}
                onChange={setTaxDocumentId}
              />
              <p className="text-sm text-slate-300">
                Completează numai după consultarea documentului original;
                valoarea netă plus TVA trebuie să coincidă cu brutul original.
                Pentru stornări, sumele păstrează semnul negativ din document.
                Alocările existente blochează schimbarea.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                {(["netAmount", "vatAmount", "evidenceReference"] as const).map(
                  (key) => (
                    <label key={key}>
                      {key === "netAmount"
                        ? "Net fiscal original"
                        : key === "vatAmount"
                          ? "TVA original"
                          : "Referință document verificat"}
                      <input
                        required
                        className={field}
                        value={tax[key]}
                        onChange={(e) =>
                          setTax({ ...tax, [key]: e.target.value })
                        }
                      />
                    </label>
                  ),
                )}
              </div>
              <button className={button} disabled={busy || !taxDocumentId}>
                Confirmă verificarea fiscală
              </button>
            </form>
          )}
          <div className="space-y-2">
            <h2 className="font-bold">Alocări active</h2>
            {report.allocations.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-white/15 p-3"
              >
                <span>
                  {row.invoiceNumber} · net {row.netAmount} · TVA{" "}
                  {row.vatAmount} · brut {row.grossAmount}
                </span>
                {canApprove && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt(
                        "Motivul inversării (minimum 5 caractere)",
                      );
                      if (reason)
                        void mutate({
                          action: "reverse_allocation",
                          allocationId: row.id,
                          reason,
                        });
                    }}
                  >
                    Inversează
                  </button>
                )}
              </div>
            ))}
          </div>
          {canWrite && (
            <form
              className="space-y-3 rounded-xl border border-white/15 p-4"
              onSubmit={(e) =>
                submit(e, {
                  action: "create_cost",
                  campaignId,
                  currency,
                  ...cost,
                })
              }
            >
              <h2 className="font-bold">Adaugă un cost pentru verificare</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  Firmă
                  <select
                    required
                    className={field}
                    value={cost.legalEntityId}
                    onChange={(e) =>
                      setCost({ ...cost, legalEntityId: e.target.value })
                    }
                  >
                    {entities.map((entity) => (
                      <option value={entity.id} key={entity.id}>
                        {entity.legalName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tip
                  <select
                    className={field}
                    value={cost.costType}
                    onChange={(e) =>
                      setCost({ ...cost, costType: e.target.value })
                    }
                  >
                    {[
                      "media",
                      "print",
                      "installation",
                      "transport",
                      "other",
                    ].map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                {(
                  [
                    "description",
                    "sourceReference",
                    "netAmount",
                    "vatAmount",
                    "grossAmount",
                  ] as const
                ).map((key) => (
                  <label key={key}>
                    {
                      {
                        description: "Descriere",
                        sourceReference: "Referință verificabilă",
                        netAmount: "Net",
                        vatAmount: "TVA",
                        grossAmount: "Brut",
                      }[key]
                    }
                    <input
                      required
                      className={field}
                      value={cost[key]}
                      onChange={(e) =>
                        setCost({ ...cost, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
              <button className={button} disabled={busy}>
                Salvează cost de verificat
              </button>
            </form>
          )}
          <div className="space-y-2">
            <h2 className="font-bold">Costuri</h2>
            {report.costs.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-white/15 p-3"
              >
                <span>
                  {row.description} · {row.sourceReference} · net{" "}
                  {row.netAmount} · {row.status}
                </span>
                {canApprove && (
                  <>
                    {row.status !== "approved" && (
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => {
                          const reason = window.prompt(
                            "Referință și motivul aprobării",
                          );
                          if (reason)
                            void mutate({
                              action: "approve_cost",
                              costId: row.id,
                              expectedVersion: row.version,
                              approve: true,
                              reason,
                            });
                        }}
                      >
                        Aprobă costul
                      </button>
                    )}
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(
                          "Motivul inversării costului",
                        );
                        if (reason)
                          void mutate({
                            action: "approve_cost",
                            costId: row.id,
                            expectedVersion: row.version,
                            approve: false,
                            reason,
                          });
                      }}
                    >
                      Inversează
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          {canApprove && (
            <form
              className="space-y-3 rounded-xl border border-white/15 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (report.campaign.startDate && report.campaign.endDate)
                  void mutate({
                    action: "confirm_coverage",
                    campaignId,
                    currency,
                    expectedFingerprint: report.sourceFingerprint,
                    coverageFrom: report.campaign.startDate,
                    coverageTo: report.campaign.endDate,
                    notes: coverageNotes,
                  });
              }}
            >
              <h2 className="font-bold">Confirmă completitudinea costurilor</h2>
              <p className="text-sm text-slate-300">
                Confirmi că ai verificat toate costurile pentru întreaga
                perioadă a campaniei, inclusiv costurile zero documentate.
                Modificarea datelor invalidează confirmarea. Marja rămâne
                neconfirmată cât timp există neconcordanțe.
              </p>
              <label>
                Justificare / surse verificate
                <textarea
                  required
                  minLength={10}
                  className={field}
                  value={coverageNotes}
                  onChange={(e) => setCoverageNotes(e.target.value)}
                />
              </label>
              <button
                className={button}
                disabled={
                  busy || !report.campaign.startDate || !report.campaign.endDate
                }
              >
                Confirmă verificarea datelor curente
              </button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
