"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Filter,
  LoaderCircle,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import type { ExecutiveOverview } from "@/lib/dashboard/executive/contracts";
import type {
  ExecutiveActivityItem,
  ExecutiveActivityResponse,
  ExecutiveAmount,
  ExecutiveCustomersResponse,
  ExecutivePeopleResponse,
  ExecutivePerson
} from "@/lib/dashboard/executive/refinement-contracts";

type TabId = "people" | "customers" | "sales" | "operations" | "finance" | "campaigns" | "inventory";
type ActivityFilter = "ALL" | "HISTORICAL" | "CURRENT" | "POSITIVE" | "PROBLEM";
type Preferences = {
  tabOrder: TabId[];
  defaultTab: TabId;
  preferredPeriod: "TODAY" | "WEEK" | "MONTH";
  collapsed: boolean;
};

const defaultTabOrder: TabId[] = ["people", "customers", "sales", "operations", "finance", "campaigns", "inventory"];
const tabLabels: Record<TabId, string> = {
  people: "Oameni",
  customers: "Clienți",
  sales: "Sales",
  operations: "Operațional",
  finance: "Financiar",
  campaigns: "Campanii",
  inventory: "Inventar"
};
const defaultPreferences: Preferences = {
  tabOrder: defaultTabOrder,
  defaultTab: "people",
  preferredPeriod: "MONTH",
  collapsed: false
};

export function ExecutiveControlTabs({ data }: { data: ExecutiveOverview }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const storageKey = `focus-ecc-preferences:${data.viewer.id}`;
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("people");
  const [customizing, setCustomizing] = useState(false);
  const [people, setPeople] = useState<ExecutivePeopleResponse | null>(null);
  const [customers, setCustomers] = useState<ExecutiveCustomersResponse | null>(null);
  const [loading, setLoading] = useState<TabId | null>(null);
  const [error, setError] = useState("");
  const scopeQuery = useMemo(() => executiveScopeQuery(data), [data]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const stored = normalizePreferences(JSON.parse(raw));
        setPreferences(stored);
        setActiveTab(stored.defaultTab);
      }
    } catch {
      // Invalid local preferences fall back to the stable product defaults.
    } finally {
      setPreferencesReady(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!preferencesReady || searchParams.has("period") || data.scope.periodPreset === preferences.preferredPeriod) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", preferences.preferredPeriod);
    params.set("entity", data.scope.entitySelection);
    params.set("snapshot", data.scope.snapshotDate);
    router.replace(`/admin/dashboard?${params}`, { scroll: false });
  }, [data.scope.entitySelection, data.scope.periodPreset, data.scope.snapshotDate, preferences.preferredPeriod, preferencesReady, router, searchParams]);

  useEffect(() => {
    if (preferences.collapsed) return;
    if ((activeTab === "people" || activeTab === "sales") && !people) void loadPeople();
    if (activeTab === "customers" && !customers) void loadCustomers();
  }, [activeTab, preferences.collapsed]);

  function savePreferences(next: Preferences) {
    setPreferences(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function selectTab(tab: TabId) {
    setActiveTab(tab);
    savePreferences({ ...preferences, defaultTab: tab });
  }

  async function loadPeople() {
    setLoading(activeTab);
    setError("");
    try {
      const response = await fetch(`/api/admin/executive/people?${scopeQuery}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Oamenii nu au putut fi încărcați.");
      setPeople(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Secțiunea nu este disponibilă.");
    } finally {
      setLoading(null);
    }
  }

  async function loadCustomers() {
    setLoading("customers");
    setError("");
    try {
      const response = await fetch(`/api/admin/executive/customers?${scopeQuery}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Clienții nu au putut fi încărcați.");
      setCustomers(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Secțiunea nu este disponibilă.");
    } finally {
      setLoading(null);
    }
  }

  function moveTab(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= preferences.tabOrder.length) return;
    const next = [...preferences.tabOrder];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    savePreferences({ ...preferences, tabOrder: next });
  }

  return (
    <section className="min-w-0 rounded-lg border border-focus-line bg-focus-navy/45" aria-labelledby="executive-domain-title">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-focus-line p-4">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Context pentru decizie</p>
          <h2 className="mt-1 text-xl font-black text-white" id="executive-domain-title">Situația pe domenii</h2>
        </div>
        <div className="flex gap-2">
          <button
            aria-expanded={customizing}
            className="focus-button secondary min-h-11"
            onClick={() => setCustomizing((value) => !value)}
            type="button"
          >
            <Settings2 size={17} /> Personalizează
          </button>
          <button
            aria-label={preferences.collapsed ? "Extinde secțiunea pe domenii" : "Restrânge secțiunea pe domenii"}
            className="focus-button secondary min-h-11 min-w-11 px-3"
            onClick={() => savePreferences({ ...preferences, collapsed: !preferences.collapsed })}
            title={preferences.collapsed ? "Extinde" : "Restrânge"}
            type="button"
          >
            {preferences.collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>
      </header>

      {customizing ? (
        <div className="grid gap-4 border-b border-focus-line bg-focus-ink/45 p-4 lg:grid-cols-[1fr_260px]">
          <div>
            <p className="text-xs font-black uppercase text-slate-400">Ordinea widgeturilor de domeniu</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {preferences.tabOrder.map((tab, index) => (
                <span className="inline-flex min-h-10 items-center gap-1 rounded border border-white/10 px-2 text-xs font-bold text-white" key={tab}>
                  {tabLabels[tab]}
                  <button aria-label={`Mută ${tabLabels[tab]} la stânga`} className="grid min-h-8 min-w-8 place-items-center text-slate-400 hover:text-white" disabled={index === 0} onClick={() => moveTab(index, -1)} title="Mută la stânga" type="button"><ArrowLeft size={15} /></button>
                  <button aria-label={`Mută ${tabLabels[tab]} la dreapta`} className="grid min-h-8 min-w-8 place-items-center text-slate-400 hover:text-white" disabled={index === preferences.tabOrder.length - 1} onClick={() => moveTab(index, 1)} title="Mută la dreapta" type="button"><ArrowRight size={15} /></button>
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Widgeturile nu pot fi eliminate. Ordinea, secțiunea restrânsă, tabul și perioada implicită sunt păstrate pentru contul curent.</p>
          </div>
          <div className="grid gap-2">
            <label className="grid gap-1 text-xs font-black uppercase text-slate-300">Tab implicit
              <select className="focus-input min-h-11" onChange={(event) => savePreferences({ ...preferences, defaultTab: event.target.value as TabId })} value={preferences.defaultTab}>
                {preferences.tabOrder.map((tab) => <option key={tab} value={tab}>{tabLabels[tab]}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-black uppercase text-slate-300">Perioadă implicită
              <select className="focus-input min-h-11" onChange={(event) => savePreferences({ ...preferences, preferredPeriod: event.target.value as Preferences["preferredPeriod"] })} value={preferences.preferredPeriod}>
                <option value="TODAY">Astăzi</option>
                <option value="WEEK">Săptămâna curentă</option>
                <option value="MONTH">Luna curentă</option>
              </select>
            </label>
            <Link className="focus-button secondary min-h-11 justify-center" href={`/admin/dashboard?entity=${data.scope.entitySelection}&snapshot=${data.scope.snapshotDate}&period=${preferences.preferredPeriod}`}>Aplică perioada preferată</Link>
          </div>
        </div>
      ) : null}

      {!preferences.collapsed ? (
        <>
          <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-focus-line p-2" role="tablist" aria-label="Domenii executive">
            {preferences.tabOrder.map((tab) => (
              <button
                aria-selected={activeTab === tab}
                className={`min-h-11 shrink-0 rounded px-4 text-sm font-black ${activeTab === tab ? "bg-focus-yellow text-focus-navy" : "text-slate-300 hover:bg-white/[0.05] hover:text-white"}`}
                key={tab}
                onClick={() => selectTab(tab)}
                role="tab"
                type="button"
              >
                {tabLabels[tab]}
              </button>
            ))}
          </div>
          <div className="min-h-72 p-4" role="tabpanel">
            {loading === activeTab ? <LoadingState /> : null}
            {error && loading !== activeTab ? <ErrorState text={error} onRetry={activeTab === "customers" ? loadCustomers : loadPeople} /> : null}
            {!loading && !error ? renderTab(activeTab, data, people, customers) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

export function ExecutiveActivityFeed({ data }: { data: ExecutiveOverview }) {
  const [activity, setActivity] = useState<ExecutiveActivityResponse | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>("ALL");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadActivity() {
    if (activity) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/executive/activity?${executiveScopeQuery(data)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Fluxul de activitate nu este disponibil.");
      setActivity(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Fluxul de activitate nu este disponibil.");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !activity) void loadActivity();
  }

  const historicalItems = (activity?.items || [])
    .filter((item) => filter !== "POSITIVE" || item.tone === "POSITIVE")
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 50);
  const showCurrent = ["ALL", "CURRENT", "PROBLEM"].includes(filter);
  const showHistorical = ["ALL", "HISTORICAL", "POSITIVE"].includes(filter);
  const attentionIds = new Set(data.attentionPreview.map((item) => item.id));
  const currentAlerts = data.alertPreview.filter((item) => !attentionIds.has(item.id));
  const hasCurrentSituations = data.attentionPreview.length > 0 || currentAlerts.length > 0;

  return (
    <section className="rounded-lg border border-focus-line bg-focus-navy/45">
      <button className="flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left" onClick={toggle} type="button">
        <span><span className="block text-xs font-black uppercase text-focus-yellow">Ce s-a schimbat</span><strong className="mt-1 block text-xl text-white">Executive Activity Feed</strong></span>
        {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>
      {open ? (
        <div className="border-t border-focus-line p-4">
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtru activitate">
            {(["ALL", "CURRENT", "HISTORICAL", "POSITIVE", "PROBLEM"] as ActivityFilter[]).map((value) => (
              <button className={`focus-button secondary min-h-10 ${filter === value ? "border-focus-yellow text-focus-yellow" : ""}`} key={value} onClick={() => setFilter(value)} type="button">
                <Filter size={15} /> {activityFilterLabel(value)}
              </button>
            ))}
          </div>
          {loading ? <LoadingState /> : error ? <ErrorState text={error} onRetry={loadActivity} /> : (
            <div className="grid gap-5">
              {showCurrent ? (
                <section>
                  <h3 className="text-xs font-black uppercase text-amber-200">Situații curente</h3>
                  <p className="mt-1 text-xs text-slate-500">Stări active acum; nu sunt prezentate ca evenimente istorice.</p>
                  <div className="mt-2 grid gap-2">
                    {hasCurrentSituations
                      ? <>
                          {data.attentionPreview.map((item) => <CurrentSituationRow item={item} key={item.id} />)}
                          {currentAlerts.map((item) => <CurrentAlertRow item={item} key={item.id} />)}
                        </>
                      : <EmptyState text="Nu există situații curente care necesită atenție." />}
                  </div>
                </section>
              ) : null}
              {showHistorical ? (
                <section>
                  <h3 className="text-xs font-black uppercase text-emerald-200">Evenimente istorice</h3>
                  <p className="mt-1 text-xs text-slate-500">Evenimente datate din ultimele 30 de zile, inclusiv ce s-a întâmplat ieri.</p>
                  <div className="mt-2 grid gap-2">
                    {historicalItems.length
                      ? historicalItems.map((item) => <ActivityRow item={item} key={item.id} />)
                      : <EmptyState text="Nu există evenimente istorice pentru filtrul selectat." />}
                  </div>
                </section>
              ) : null}
            </div>
          )}
          {activity?.unavailableSources.length ? (
            <details className="mt-4 rounded border border-white/10 p-3 text-xs text-slate-400">
              <summary className="min-h-9 cursor-pointer font-bold text-slate-300">Surse indisponibile</summary>
              <ul className="mt-2 grid gap-1">{activity.unavailableSources.map((item) => <li key={item}>• {item}</li>)}</ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function renderTab(
  tab: TabId,
  data: ExecutiveOverview,
  people: ExecutivePeopleResponse | null,
  customers: ExecutiveCustomersResponse | null
) {
  if (tab === "people") return people ? <PeopleGrid people={people.people} notes={people.notes} /> : <EmptyState text="Deschide din nou tabul pentru încărcare." />;
  if (tab === "sales") return people ? <PeopleGrid people={people.people.filter((person) => ["SALES_AGENT", "SALES_DIRECTOR"].includes(person.role))} notes={people.notes} sales /> : <EmptyState text="Datele Sales se încarcă la cerere." />;
  if (tab === "customers") return customers ? <CustomerViews data={customers} /> : <EmptyState text="Clienții se încarcă la cerere." />;
  if (tab === "operations") return <OperationsView data={data} />;
  if (tab === "finance") return <FinanceView data={data} />;
  if (tab === "campaigns") return <CampaignView data={data} />;
  return <InventoryView data={data} />;
}

function PeopleGrid({ people, notes, sales = false }: { people: ExecutivePerson[]; notes: string[]; sales?: boolean }) {
  return (
    <div>
      {notes.length ? <div className="mb-3 rounded border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs text-amber-100">{notes.map((note) => <p key={note}>• {note}</p>)}</div> : null}
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {people.length ? people.map((person) => (
        <article className="rounded-md border border-white/10 bg-focus-ink/50 p-4" key={person.id}>
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0"><strong className="block truncate text-white">{person.name}</strong><small className="text-slate-400">{person.roleLabel} · {person.department}</small></span>
            <span className={`rounded px-2 py-1 text-[10px] font-black ${person.issues.length ? "bg-amber-300/10 text-amber-100" : "bg-emerald-300/10 text-emerald-100"}`}>{person.issues.length ? `${person.issues.length} semnale` : "Fără semnale"}</span>
          </div>
          <div className="mt-3 rounded border border-white/10 bg-white/[0.025] p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase text-slate-400">Încărcare factuală</span>
              <strong className={person.workload.level === "HIGH" ? "text-amber-200" : person.workload.level === "NORMAL" ? "text-emerald-200" : "text-slate-300"}>
                {person.workload.level === "HIGH" ? "Ridicată" : person.workload.level === "NORMAL" ? "Normală" : "Nedeterminată"}
              </strong>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-400">{person.workload.explanation.join(" · ")}</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <SmallMetric label="Clienți" value={person.clientsManaged} />
            <SmallMetric label="Campanii" value={person.campaignsManaged} />
            <SmallMetric label={sales ? "Oportunități" : "Taskuri deschise"} value={sales ? person.openOpportunities : person.openTasks} />
            <SmallMetric label={sales ? "Follow-up-uri" : "Taskuri finalizate"} value={sales ? person.openCrmActions : person.completedTasks} />
          </div>
          {sales && person.pipeline.length ? <AmountList label="Pipeline brut" rows={person.pipeline} /> : null}
          <p className="mt-3 text-xs text-slate-400">Ultima activitate business: <strong className="text-slate-200">{person.lastBusinessActivityAt ? dateTime(person.lastBusinessActivityAt) : "Nicio activitate înregistrată"}</strong></p>
          {person.issues.length ? <div className="mt-3 grid gap-1">{person.issues.map((issue) => <Link className="flex min-h-9 items-center justify-between rounded border border-amber-300/15 px-2 text-xs text-amber-100 hover:border-focus-yellow" href={issue.href} key={issue.code}><span>{issue.label}</span><strong>{issue.count}</strong></Link>)}</div> : null}
          <p className="mt-3 text-[10px] uppercase text-slate-500">Departament derivat din rol · calitate {person.dataQuality}</p>
        </article>
      )) : <EmptyState text="Nu există persoane cu responsabilități legate canonic de scope-ul selectat." />}
      </div>
    </div>
  );
}

function CustomerViews({ data }: { data: ExecutiveCustomersResponse }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <CustomerColumn title="Top Business" subtitle="Activitate comercială demonstrabilă, fără consolidare valutară" rows={data.topBusiness} tone="positive" />
      <CustomerColumn title="Top Risk" subtitle="Restanțe, campanii și ownership care necesită atenție" rows={data.topRisk} tone="risk" />
      <div className="xl:col-span-2">{data.notes.map((note) => <p className="text-xs text-slate-500" key={note}>• {note}</p>)}</div>
    </div>
  );
}

function CustomerColumn({ title, subtitle, rows, tone }: { title: string; subtitle: string; rows: ExecutiveCustomersResponse["topBusiness"]; tone: "positive" | "risk" }) {
  return (
    <section>
      <h3 className="font-black text-white">{title}</h3>
      <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
      <div className="mt-3 grid gap-2">
        {rows.length ? rows.map((row) => (
          <Link className="rounded-md border border-white/10 bg-focus-ink/50 p-3 hover:border-focus-yellow" href={row.href} key={row.id}>
            <div className="flex items-start justify-between gap-3"><span className="min-w-0"><strong className="block truncate text-white">{row.companyName}</strong><small className="text-slate-400">{row.ownerLabel}</small></span><span className={`text-xs font-black ${tone === "risk" ? "text-red-200" : "text-emerald-200"}`}>{tone === "risk" ? countLabel(row.riskIssues.length, "risc", "riscuri") : countLabel(row.activeCampaigns, "activă", "active")}</span></div>
            <p className="mt-2 text-xs text-slate-300">{countLabel(row.activeCampaigns, "campanie activă", "campanii active")} · {countLabel(row.upcomingCampaigns, "campanie viitoare", "campanii viitoare")} · {countLabel(row.bookedReservations, "rezervare BOOKED", "rezervări BOOKED")}</p>
            <p className="mt-2 text-xs text-slate-400"><strong className="text-slate-200">De ce apare aici:</strong> {tone === "risk" ? row.riskIssues.join(" · ") : row.businessReasons.join(" · ") || "Activitate comercială demonstrabilă"}</p>
            {tone === "risk" ? <p className="mt-2 text-xs text-amber-100">{row.riskIssues.join(" · ")}</p> : <AmountList label="Valoare contractuală" rows={row.businessValue} />}
            {row.overdue.length ? <AmountList label="Restant" rows={row.overdue} warning /> : null}
          </Link>
        )) : <EmptyState text="Nu există clienți pentru această categorie." />}
      </div>
    </section>
  );
}

function OperationsView({ data }: { data: ExecutiveOverview }) {
  const issues = data.attentionPreview.filter((item) => item.domain === "OPERATIONS");
  return <div className="grid gap-4 lg:grid-cols-4"><SmallMetric label="Taskuri deschise" value={data.summary.openOperationTasks} /><SmallMetric label="Decorări astăzi" value={data.summary.operationsToday.decorations} /><SmallMetric label="Neutralizări astăzi" value={data.summary.operationsToday.neutralizations} /><SmallMetric label="Confidence" value={`${data.summary.operationsToday.confidence}%`} /><div className="lg:col-span-4"><AttentionLinks rows={issues} empty="Nu există semnale operaționale în Top 10." /></div></div>;
}

function FinanceView({ data }: { data: ExecutiveOverview }) {
  return <div className="grid gap-4 lg:grid-cols-3"><AmountList label="Încasări în perioadă" rows={data.summary.collectionsThisMonth} /><AmountList label="Facturi restante" rows={data.summary.overdueInvoices} warning /><AmountList label="Scadente în 7 zile" rows={data.summary.dueWithinSevenDays} warning /></div>;
}

function CampaignView({ data }: { data: ExecutiveOverview }) {
  return <div><div className="grid gap-3 sm:grid-cols-4"><SmallMetric label="Active" value={data.summary.activeCampaigns} href={campaignHref(data, "effectiveStatus", "ACTIVE")} /><SmallMetric label="Încep astăzi" value={data.summary.campaignsStartingToday} href={campaignHref(data, "dateFilter", "STARTS_ON")} /><SmallMetric label="Se încheie astăzi" value={data.summary.campaignsEndingToday} href={campaignHref(data, "dateFilter", "ENDS_ON")} /><SmallMetric label="În risc" value={data.summary.campaignRisks} href={dashboardHref(data, "campaign-risks", "campaign-risks")} /></div><div className="mt-4 grid gap-2">{data.campaignRisks.length ? data.campaignRisks.map((risk) => <Link className="flex min-h-12 items-center justify-between gap-3 rounded border border-white/10 px-3 hover:border-focus-yellow" href={risk.href} key={risk.id}><span className="min-w-0"><strong className="block truncate text-white">{risk.campaignName}</strong><small className="block truncate text-slate-400">{risk.clientName} · {risk.reasonCodes.join(" · ")}</small></span><strong className="text-amber-200">{risk.severity}</strong></Link>) : <EmptyState text="Nu există campanii în risc pentru scope-ul curent." />}</div></div>;
}

function InventoryView({ data }: { data: ExecutiveOverview }) {
  if (data.summary.filterApplicability.inventory === "FILTER_NOT_APPLICABLE") {
    return <EmptyState text="Filtrul juridic nu se aplică inventarului comun. Selectează toate entitățile pentru datele de inventar." />;
  }
  const inventory = data.summary.inventory;
  const rows = [["Disponibile", inventory.available], ["BOOKED", inventory.booked], ["HOLD", inventory.hold], ["Mentenanță", inventory.maintenance], ["Blocate", inventory.manualUnavailable], ["Necunoscute", inventory.unknown]];
  return <div><div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">{rows.map(([label, value]) => <SmallMetric key={label} label={String(label)} value={value} />)}</div><p className="mt-4 text-sm text-slate-300">Ocupare: <strong className="text-white">{inventory.occupancyRate == null ? "Date insuficiente" : `${inventory.occupancyRate}%`}</strong> · {inventory.booked} suporturi BOOKED din {inventory.eligible} eligibile.</p></div>;
}

function AttentionLinks({ rows, empty }: { rows: ExecutiveOverview["attentionPreview"]; empty: string }) {
  return <div className="grid gap-2">{rows.length ? rows.map((row) => <Link className="flex min-h-11 items-center justify-between gap-3 rounded border border-white/10 px-3 hover:border-focus-yellow" href={row.href} key={row.id}><span className="min-w-0"><strong className="block truncate text-white">{row.title}</strong><small className="block truncate text-slate-400">{row.responsibleLabel} · {row.why}</small></span><strong className="text-amber-200">{row.impactLabel}</strong></Link>) : <EmptyState text={empty} />}</div>;
}

function ActivityRow({ item }: { item: ExecutiveActivityItem }) {
  const tone = item.tone === "POSITIVE" ? "text-emerald-200" : item.tone === "PROBLEM" ? "text-red-200" : "text-slate-300";
  const icon = item.tone === "POSITIVE" ? <CheckCircle2 size={17} /> : item.tone === "PROBLEM" ? <ShieldAlert size={17} /> : <Clock3 size={17} />;
  return <Link className="grid min-h-14 grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 rounded border border-white/10 px-3 hover:border-focus-yellow" href={item.href}><span className={tone}>{icon}</span><span className="min-w-0"><strong className="block truncate text-white">{item.title}</strong><small className="block truncate text-slate-400">{item.detail}</small></span><time className="text-xs text-slate-500">{dateTime(item.occurredAt)}</time></Link>;
}

function CurrentSituationRow({ item }: { item: ExecutiveOverview["attentionPreview"][number] }) {
  return <Link className="grid min-h-14 grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 rounded border border-amber-300/20 bg-amber-300/[0.04] px-3 hover:border-focus-yellow" href={item.href}><span className="text-amber-200"><ShieldAlert size={17} /></span><span className="min-w-0"><strong className="block truncate text-white">{item.title}</strong><small className="block truncate text-slate-400">{item.summary}</small></span><span className="text-xs font-black text-amber-100">{item.severity}</span></Link>;
}

function CurrentAlertRow({ item }: { item: ExecutiveOverview["alertPreview"][number] }) {
  const severity = item.severityCode === "DATA_QUALITY" ? "Calitatea datelor" : item.severityCode || "Informativ";
  return (
    <Link className="grid min-h-12 gap-1 rounded border border-amber-300/20 bg-amber-300/[0.04] px-3 py-2 text-xs hover:border-focus-yellow sm:grid-cols-[minmax(0,1fr)_auto]" href={item.href}>
      <span className="min-w-0"><strong className="block truncate text-white">{item.label}</strong><span className="text-slate-400">{item.detail}</span></span>
      <span className="self-center font-black text-amber-100">{severity} · {item.count}</span>
    </Link>
  );
}

function SmallMetric({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const content = <><span className="text-[10px] font-black uppercase text-slate-400">{label}</span><strong className="mt-2 block text-xl text-white">{value}</strong></>;
  return href
    ? <Link className="rounded-md border border-white/10 bg-focus-ink/50 p-3 hover:border-focus-yellow" href={href}>{content}</Link>
    : <div className="rounded-md border border-white/10 bg-focus-ink/50 p-3">{content}</div>;
}

function AmountList({ label, rows, warning = false }: { label: string; rows: ExecutiveAmount[] | ExecutiveOverview["summary"]["collectionsThisMonth"]; warning?: boolean }) {
  return <div className="min-w-0 rounded-md border border-white/10 bg-focus-ink/45 p-3"><p className="text-[10px] font-black uppercase text-slate-400">{label}</p><div className="mt-2 grid gap-1">{rows.length ? rows.map((row) => <div className="flex justify-between gap-2 text-xs" key={`${row.entityCode}-${row.currency}`}><span className="text-slate-400">{row.entityCode} · {row.count}</span><strong className={warning ? "text-red-100" : "text-emerald-200"}>{amountLabel(row.amount, row.currency)}</strong></div>) : <span className="text-xs text-slate-500">Date insuficiente</span>}</div></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex min-h-20 items-center rounded border border-dashed border-focus-line px-4 text-sm text-slate-400">{text}</div>;
}

function LoadingState() {
  return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-400"><LoaderCircle className="animate-spin text-focus-yellow" size={20} /> Se încarcă numai datele acestui tab...</div>;
}

function ErrorState({ text, onRetry }: { text: string; onRetry: () => void }) {
  return <div className="flex min-h-28 flex-wrap items-center justify-between gap-3 rounded border border-red-300/25 bg-red-400/[0.06] p-4 text-sm text-red-100"><span>{text}</span><button className="focus-button secondary" onClick={() => void onRetry()} type="button">Reîncearcă</button></div>;
}

function executiveScopeQuery(data: ExecutiveOverview) {
  return new URLSearchParams({
    entity: data.scope.entitySelection,
    snapshot: data.scope.snapshotDate,
    period: data.scope.periodPreset,
    periodStart: data.scope.periodStart,
    periodEnd: data.scope.periodEnd
  }).toString();
}

function normalizePreferences(input: Partial<Preferences>): Preferences {
  const order = Array.isArray(input.tabOrder)
    ? input.tabOrder.filter((tab): tab is TabId => defaultTabOrder.includes(tab as TabId))
    : [];
  const tabOrder = [...order, ...defaultTabOrder.filter((tab) => !order.includes(tab))];
  const defaultTab = defaultTabOrder.includes(input.defaultTab as TabId) ? input.defaultTab as TabId : "people";
  const preferredPeriod = ["TODAY", "WEEK", "MONTH"].includes(String(input.preferredPeriod))
    ? input.preferredPeriod as Preferences["preferredPeriod"]
    : "MONTH";
  return { tabOrder, defaultTab, preferredPeriod, collapsed: Boolean(input.collapsed) };
}

function activityFilterLabel(value: ActivityFilter) {
  return {
    ALL: "Toate",
    CURRENT: "Situații curente",
    HISTORICAL: "Istoric",
    POSITIVE: "Pozitive",
    PROBLEM: "Probleme"
  }[value];
}

function campaignHref(data: ExecutiveOverview, key: "effectiveStatus" | "dateFilter", value: string) {
  const params = new URLSearchParams({ snapshot: data.scope.snapshotDate, [key]: value });
  if (data.scope.entitySelection !== "ALL") params.set("entity", data.scope.entitySelection);
  return `/admin/campanii?${params}`;
}

function dashboardHref(data: ExecutiveOverview, panel: string, hash: string) {
  const params = new URLSearchParams({
    entity: data.scope.entitySelection,
    snapshot: data.scope.snapshotDate,
    period: data.scope.periodPreset,
    periodStart: data.scope.periodStart,
    periodEnd: data.scope.periodEnd,
    panel
  });
  return `/admin/dashboard?${params}#${hash}`;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }).format(new Date(value));
}

function amountLabel(value: string, currency: string) {
  return `${new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 }).format(Number(value))} ${currency}`;
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}
