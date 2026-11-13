import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, CalendarClock, MapPinned, PhoneCall, ReceiptText, Wrench } from "lucide-react";
import type { SalesDashboardData } from "@/lib/dashboard/sales-dashboard";
import { SalesWorkQueue } from "@/components/admin/SalesWorkQueue";

export function SalesCommandCenter({ data }: { data: SalesDashboardData }) {
  return <main className="focus-shell py-7"><div className="focus-container grid min-w-0 gap-6">
    <header className="flex min-w-0 flex-wrap items-end justify-between gap-4 border-b border-focus-line pb-5">
      <div className="min-w-0"><p className="text-xs font-black uppercase text-focus-yellow">Vânzări OOH</p><h1 className="mt-1 font-display text-3xl font-black text-white sm:text-4xl">Agenda mea</h1><p className="mt-2 max-w-2xl text-sm text-slate-300">Bună, {data.userName.split(" ")[0]}. Începe cu acțiunile urgente sau pregătește următoarea ofertă.</p></div>
      <div className="flex flex-wrap gap-2"><Link className="focus-button" href="/admin/selectie-locatii" prefetch={false}><MapPinned size={18} />Construiește oferta</Link><Link className="focus-button secondary" href="/admin/crm?view=today" prefetch={false}><PhoneCall size={18} />CRM astăzi</Link></div>
    </header>
    <section aria-label="Inventarul disponibil pentru vânzare" className="min-w-0 rounded-xl border border-focus-line bg-focus-ink/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-black text-white">Ce putem vinde astăzi</h2><Link className="section-link min-h-11" href="/admin/selectie-locatii" prefetch={false}>Verifică perioada clientului<ArrowRight size={14} /></Link></div>
      {data.inventory ? <>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><InventoryMetric label="Libere azi" value={data.inventory.freeToday} primary /><InventoryMetric label="Ocupate azi" value={data.inventory.occupiedToday} /><InventoryMetric label="HOLD azi" value={data.inventory.heldToday} /><InventoryMetric label="Blocate / de verificat" value={data.inventory.blockedToday + data.inventory.unknownToday} /></div>
        <p className="mt-3 text-xs text-slate-400">{data.inventory.staticLocations} locații OOH active în firmă · {data.inventory.maintenanceLocations} în mentenanță, în afara totalului activ. Situație la {formatDateTime(data.inventory.asOf)} (București). Pentru o campanie, verifică întregul interval.</p>
      </> : <p role="status" className="mt-3 text-sm font-bold text-amber-200">Disponibilitatea nu a putut fi verificată. Actualizează pagina sau deschide inventarul; numărul locațiilor libere este momentan necunoscut.</p>}
    </section>
    <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Rezumat agenda mea">
      <SalesMetric icon={<PhoneCall size={18} />} label="De urmărit azi" value={data.summary.followUpsDue} detail={`${data.summary.overdueFollowUps} restante`} href="/admin/crm?view=today" />
      <SalesMetric icon={<ReceiptText size={18} />} label="Scadențe clienții mei" value={data.summary.overdueInvoices} detail={`${data.summary.dueSoonInvoices} în următoarele 7 zile`} href="/admin/clienti?tab=invoices" />
      <SalesMetric icon={<BriefcaseBusiness size={18} />} label="Încep curând" value={data.summary.campaignsStarting} detail="Campanii în 7 zile" href={data.links.campaignsStarting} />
      <SalesMetric icon={<CalendarClock size={18} />} label="Se termină curând" value={data.summary.campaignsEnding} detail="Campanii în 7 zile" href={data.links.campaignsEnding} />
      <SalesMetric icon={<Wrench size={18} />} label="Probleme operaționale" value={data.summary.operationalProblems} detail="La clienții mei" href="/admin/operational" />
    </section>
    <SalesWorkQueue items={data.agenda} cappedSources={data.agendaCoverage.cappedSources} />
    <section className="grid min-w-0 gap-3 sm:grid-cols-3" aria-label="Dosarele mele comerciale">
      <Shortcut title="Clienții mei" text="Contacte, documente și facturi în dosarul clientului." href="/admin/clienti" />
      <Shortcut title="Campaniile mele" text="Locații închiriate, perioade și stadiul execuției." href="/admin/campanii" />
      <Shortcut title="Ofertele mele" text="Versiuni, prețuri propuse și aprobări." href="/admin/commercial-quotes" />
    </section>
    <p className="text-right text-xs text-slate-500">Actualizat {formatDateTime(data.generatedAt)} · București</p>
  </div></main>;
}

function SalesMetric({ icon, label, value, detail, href }: { icon: React.ReactNode; label: string; value: number; detail: string; href: string }) {
  return <Link className="min-w-0 rounded-lg border border-focus-line bg-focus-ink/65 p-4 transition hover:border-focus-yellow" href={href} prefetch={false}><div className="flex items-start justify-between gap-2 text-slate-400"><span className="text-xs font-black uppercase">{label}</span>{icon}</div><strong className="mt-2 block text-2xl font-black tabular-nums text-white">{value}</strong><span className="mt-1 block text-xs text-slate-400">{detail}</span></Link>;
}
function InventoryMetric({ label, value, primary = false }: { label: string; value: number; primary?: boolean }) {
  return <div className="min-w-0"><strong className={`block text-3xl font-black tabular-nums ${primary ? "text-emerald-200" : "text-white"}`}>{value}</strong><span className="text-xs font-bold text-slate-400">{label}</span></div>;
}
function Shortcut({ title, text, href }: { title: string; text: string; href: string }) {
  return <Link className="min-w-0 rounded-lg border border-focus-line p-4 hover:border-focus-yellow" href={href} prefetch={false}><strong className="flex items-center justify-between gap-2 text-white">{title}<ArrowRight size={16} /></strong><p className="mt-2 text-sm text-slate-400">{text}</p></Link>;
}
function formatDateTime(value: string) { return new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
