"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarClock, ChevronLeft, ChevronRight, PhoneCall, RefreshCw, Search, TimerReset } from "lucide-react";
import { selectSalesAgenda, type SalesAgendaItem, type SalesAgendaKind } from "@/lib/dashboard/sales-agenda";

const categories: Array<{ value: SalesAgendaKind | "all"; label: string }> = [
  { value: "all", label: "Toate acțiunile" }, { value: "follow_up", label: "Follow-up-uri" },
  { value: "hold", label: "HOLD-uri" }, { value: "campaign_end", label: "Reînnoiri" },
  { value: "invoice", label: "Scadențe" }, { value: "campaign_start", label: "Campanii noi" },
  { value: "operation", label: "Execuție" },
];

export function SalesWorkQueue({ items, cappedSources }: { items: SalesAgendaItem[]; cappedSources: string[] }) {
  const [kind, setKind] = useState<SalesAgendaKind | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, startTransition] = useTransition();
  const router = useRouter();
  const result = selectSalesAgenda(items, { kind, query, page });
  return <section className="min-w-0 rounded-xl border border-focus-line bg-focus-navy/50 p-4 sm:p-5" aria-label="Agenda comercială">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-2xl font-black text-white">Ce am de făcut azi</h2><p className="mt-1 text-sm text-slate-400">Apeluri, rezervări temporare, reînnoiri și încasări. Poți vedea fiecare categorie separat.</p></div>
      <button className="focus-button secondary shrink-0" type="button" disabled={refreshing} onClick={() => startTransition(() => router.refresh())}><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />{refreshing ? "Actualizare…" : "Actualizează"}</button>
    </div>
    <div className="mt-4 flex min-w-0 flex-wrap gap-2" aria-label="Categorii de acțiuni">
      {categories.map((category) => <button key={category.value} type="button" aria-pressed={kind === category.value}
        onClick={() => { setKind(category.value); setPage(1); }}
        className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-bold ${kind === category.value ? "border-focus-yellow bg-focus-yellow text-focus-dark" : "border-focus-line text-slate-200 hover:border-focus-yellow"}`}>
        {category.label}<span className="ml-2 tabular-nums">{category.value === "all" ? items.length : items.filter((item) => item.kind === category.value).length}</span>
      </button>)}
    </div>
    <label className="mt-4 flex min-w-0 items-center gap-2 rounded-lg border border-focus-line px-3 text-slate-400"><Search size={18} /><span className="sr-only">Caută în agenda comercială</span><input className="min-h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none" placeholder="Caută un client, o campanie sau un cod de locație" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
    {cappedSources.length > 0 && <p role="status" className="mt-3 rounded-lg border border-amber-400/40 p-3 text-sm text-amber-100">Agenda rezumă maximum 500 de înregistrări din fiecare sursă. Limita a fost atinsă pentru {cappedSources.join(", ")}; consultă listele complete din CRM, Clienți, Campanii sau Inventar.</p>}
    <div className="mt-4 grid gap-2" aria-live="polite">
      {result.rows.map((item) => <WorkRow key={item.id} item={item} />)}
      {!result.rows.length && <div className="rounded-lg border border-dashed border-focus-line p-5 text-sm text-slate-300">{query ? "Nicio acțiune nu corespunde căutării." : kind === "all" ? "Nu ai acțiuni în intervalele urmărite. Deschide CRM pentru următoarea oportunitate." : "Nu ai acțiuni în această categorie."}</div>}
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
      <p>{result.total} acțiuni · pagina {result.page} din {result.pages}</p>
      <div className="flex gap-2"><button className="focus-button secondary" type="button" aria-label="Pagina anterioară a agendei" disabled={result.page <= 1} onClick={() => setPage(result.page - 1)}><ChevronLeft size={18} />Înapoi</button><button className="focus-button secondary" type="button" aria-label="Pagina următoare a agendei" disabled={result.page >= result.pages} onClick={() => setPage(result.page + 1)}>Înainte<ChevronRight size={18} /></button></div>
    </div>
    <p className="mt-3 text-xs text-slate-400">Urmărire: follow-up-uri și scadențe în 7 zile, reînnoiri în 60 de zile, HOLD-uri active și lucrări apropiate de termen. Disponibilitatea se verifică din nou înaintea rezervării.</p>
  </section>;
}

function WorkRow({ item }: { item: SalesAgendaItem }) {
  const icon = item.kind === "hold" ? <TimerReset size={18} /> : item.kind === "follow_up" ? <PhoneCall size={18} /> : <CalendarClock size={18} />;
  const tone = item.urgency === "critical" ? "border-red-300/35 bg-red-500/10" : item.urgency === "high" ? "border-amber-300/35 bg-amber-400/10" : "border-focus-line bg-focus-ink/55";
  return <article className={`grid min-w-0 gap-3 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_auto] ${tone}`}>
    <div className="min-w-0"><div className="flex items-start gap-2"><span className="mt-0.5 shrink-0 text-focus-yellow">{icon}</span><strong className="break-words text-sm text-white">{item.title}</strong></div><p className="mt-1 break-words text-sm text-slate-300">{item.context}</p></div>
    <div className="flex flex-wrap items-center gap-3 md:justify-end">{item.amount && <strong className="text-sm text-white">{new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 }).format(Number(item.amount))} {item.currency}</strong>}
      {item.dueDate && <time className="text-xs text-slate-300" dateTime={item.dueDate}>{new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", ...(item.kind === "hold" ? { timeStyle: "short" } : {}) }).format(new Date(item.dueDate))}</time>}
      <Link className="section-link min-h-10" href={item.href} prefetch={false}>{item.actionLabel}<ArrowRight size={14} /></Link>
    </div>
  </article>;
}
