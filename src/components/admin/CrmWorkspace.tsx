"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, ClipboardList, Plus, Save, Search } from "lucide-react";
import { adminNewReservationHref } from "@/lib/admin-routes";

type Seller = { id: string; name: string; email: string; role: string };
type CrmActivity = {
  id: string;
  actionType: string | null;
  type: string;
  activityDate: string;
  statusAtTime: string | null;
  details: string | null;
  locations: string | null;
  nextStep: string | null;
  nextFollowUpDate: string | null;
  note: string | null;
};
type CrmContact = { id: string; name: string; role: string | null; phone: string | null; email: string | null; isPrimary: boolean };
type CrmLead = {
  id: string;
  leadDate: string | null;
  companyName: string;
  clientType: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  assignedToUserId: string | null;
  estimatedValue: number | null;
  currency: string | null;
  nextFollowUpDate: string | null;
  locationsInterested: string | null;
  notes: string | null;
  assignedTo?: Seller | null;
  contacts: CrmContact[];
  activities: CrmActivity[];
};

const statuses = [
  ["cold", "Cold"],
  ["qualified", "Calificat"],
  ["in_analysis", "In analiza"],
  ["in_offer", "In ofertare"],
  ["in_negotiation", "In negociere"],
  ["in_contracting", "In contractare"],
  ["on_hold", "On Hold"],
  ["no_response", "Nu raspunde"],
  ["account_management", "Account Management"],
  ["won", "Castigat"],
  ["lost", "Pierdut"],
  ["inactive", "Inactiv"]
] as const;

const clientTypes = [
  ["direct_client", "Client Direct"],
  ["agency", "Agentie"]
] as const;

const actionTypes = [
  ["prospectare", "Prospectare"],
  ["telefon", "Telefon"],
  ["email", "E-mail"],
  ["vizita", "Vizita"],
  ["whatsapp", "WhatsApp"],
  ["meeting", "Meeting"],
  ["note", "Nota"],
  ["offer_sent", "Oferta trimisa"],
  ["follow_up", "Follow-up"]
] as const;

export function CrmWorkspace({ currentUserId, canViewTeam }: { currentUserId: string; canViewTeam: boolean }) {
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sellerFilter, setSellerFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newLead, setNewLead] = useState({
    leadDate: new Date().toISOString().slice(0, 10),
    companyName: "",
    clientType: "direct_client",
    status: "cold",
    contactName: "",
    contactRole: "",
    phone: "",
    email: "",
    source: "CRM",
    locationsInterested: "",
    notes: "",
    nextFollowUpDate: "",
    assignedToUserId: currentUserId
  });
  const [activityByLead, setActivityByLead] = useState<Record<string, { actionType: string; details: string; locations: string; nextFollowUpDate: string; statusAtTime: string }>>({});

  useEffect(() => {
    refresh();
    fetch("/api/admin/sellers", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setSellers(Array.isArray(payload?.sellers) ? payload.sellers : []))
      .catch(() => setSellers([]));
  }, []);

  const visibleLeads = useMemo(() => {
    const needle = query.toLowerCase();
    return leads.filter((lead) => {
      if (statusFilter && lead.status !== statusFilter) return false;
      if (sellerFilter && lead.assignedToUserId !== sellerFilter) return false;
      if (!needle) return true;
      return [lead.companyName, lead.contactName, lead.email, lead.phone, lead.locationsInterested, lead.notes, lead.assignedTo?.name]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [leads, query, sellerFilter, statusFilter]);

  async function refresh() {
    const response = await fetch("/api/admin/crm/leads", { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) setLeads(payload.leads || []);
  }

  async function createLead() {
    if (!newLead.companyName.trim()) return;
    setBusy("create");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/crm/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newLead)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Lead-ul nu a putut fi creat.");
      setMessage("Lead creat.");
      setNewLead((current) => ({ ...current, companyName: "", contactName: "", contactRole: "", phone: "", email: "", locationsInterested: "", notes: "" }));
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Lead-ul nu a putut fi creat.");
    } finally {
      setBusy(null);
    }
  }

  async function updateLead(id: string, patch: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/crm/leads/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Lead-ul nu a putut fi actualizat.");
      setLeads((current) => current.map((lead) => lead.id === id ? payload.lead : lead));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Lead-ul nu a putut fi actualizat.");
    } finally {
      setBusy(null);
    }
  }

  async function addActivity(lead: CrmLead) {
    const input = activityByLead[lead.id] || { actionType: "telefon", details: "", locations: lead.locationsInterested || "", nextFollowUpDate: "", statusAtTime: lead.status };
    if (!input.details.trim()) {
      setError("Scrie detaliile activitatii.");
      return;
    }
    setBusy(`activity-${lead.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/admin/crm/leads/${lead.id}/activities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Activitatea nu a putut fi salvata.");
      setActivityByLead((current) => ({ ...current, [lead.id]: { actionType: "telefon", details: "", locations: input.locations, nextFollowUpDate: input.nextFollowUpDate, statusAtTime: input.statusAtTime } }));
      await refresh();
    } catch (activityError) {
      setError(activityError instanceof Error ? activityError.message : "Activitatea nu a putut fi salvata.");
    } finally {
      setBusy(null);
    }
  }

  return <main className="focus-shell py-8">
    <div className="focus-container grid gap-6">
      <section className="grid gap-4 border-b border-focus-line pb-5 xl:grid-cols-[1fr_auto]">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">CRM Focus Media</p>
          <h1 className="font-display text-4xl font-black uppercase text-white">Pipeline vanzari</h1>
          <p className="mt-2 max-w-3xl text-sm font-bold text-slate-300">Lead-uri si activitati in stil jurnal, dupa modelul Edward CRM.</p>
        </div>
        <Link className="focus-button" href={adminNewReservationHref({ source: "crm" })}><ClipboardList size={18} /> Creeaza hold</Link>
      </section>

      {message ? <Feedback tone="green" text={message} /> : null}
      {error ? <Feedback tone="red" text={error} /> : null}

      <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <input className="focus-input" type="date" value={newLead.leadDate} onChange={(event) => setNewLead((current) => ({ ...current, leadDate: event.target.value }))} />
          <input className="focus-input" placeholder="Lead / companie" value={newLead.companyName} onChange={(event) => setNewLead((current) => ({ ...current, companyName: event.target.value }))} />
          <select className="focus-input" value={newLead.clientType} onChange={(event) => setNewLead((current) => ({ ...current, clientType: event.target.value }))}>{clientTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select className="focus-input" value={newLead.status} onChange={(event) => setNewLead((current) => ({ ...current, status: event.target.value }))}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          {canViewTeam ? <select className="focus-input" value={newLead.assignedToUserId} onChange={(event) => setNewLead((current) => ({ ...current, assignedToUserId: event.target.value }))}>{sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</select> : null}
          <button className="focus-button" type="button" disabled={busy === "create"} onClick={createLead}><Plus size={18} /> Adauga lead</button>
          <input className="focus-input" placeholder="Persoana contact" value={newLead.contactName} onChange={(event) => setNewLead((current) => ({ ...current, contactName: event.target.value }))} />
          <input className="focus-input" placeholder="Functie" value={newLead.contactRole} onChange={(event) => setNewLead((current) => ({ ...current, contactRole: event.target.value }))} />
          <input className="focus-input" placeholder="Telefon" value={newLead.phone} onChange={(event) => setNewLead((current) => ({ ...current, phone: event.target.value }))} />
          <input className="focus-input" placeholder="E-mail" value={newLead.email} onChange={(event) => setNewLead((current) => ({ ...current, email: event.target.value }))} />
          <input className="focus-input" placeholder="Locatii" value={newLead.locationsInterested} onChange={(event) => setNewLead((current) => ({ ...current, locationsInterested: event.target.value }))} />
          <input className="focus-input" type="date" value={newLead.nextFollowUpDate} onChange={(event) => setNewLead((current) => ({ ...current, nextFollowUpDate: event.target.value }))} />
        </div>
        <textarea className="focus-input mt-3 min-h-20" placeholder="Detalii / urmator pas" value={newLead.notes} onChange={(event) => setNewLead((current) => ({ ...current, notes: event.target.value }))} />
      </section>

      <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="focus-input pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cauta lead, contact, email, locatie" />
          </label>
          <select className="focus-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Toate statusurile</option>
            {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {canViewTeam ? <select className="focus-input" value={sellerFilter} onChange={(event) => setSellerFilter(event.target.value)}>
            <option value="">Toti vanzatorii</option>
            {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
          </select> : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-focus-line bg-focus-ink/70">
        <div className="max-h-[680px] overflow-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead className="sticky top-0 z-10 bg-focus-navy text-left text-xs uppercase text-slate-400">
              <tr><th className="px-3 py-2">Data Lead</th><th className="px-3 py-2">Lead</th><th className="px-3 py-2">Tip client</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actiune</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Detalii</th><th className="px-3 py-2">Locatii</th><th className="px-3 py-2">Follow-up</th></tr>
            </thead>
            <tbody>{visibleLeads.length ? visibleLeads.map((lead) => {
              const latest = lead.activities?.[0];
              const activity = activityByLead[lead.id] || { actionType: latest?.actionType || "telefon", details: "", locations: lead.locationsInterested || "", nextFollowUpDate: lead.nextFollowUpDate?.slice(0, 10) || "", statusAtTime: lead.status };
              return <tr className="border-t border-focus-line align-top" key={lead.id}>
                <td className="px-3 py-3">{lead.leadDate ? date(lead.leadDate) : date(lead.activities?.[0]?.activityDate || new Date().toISOString())}</td>
                <td className="px-3 py-3 font-black text-white">{lead.companyName}<small className="block text-slate-400">{lead.assignedTo?.name || "Nealocat"}</small></td>
                <td className="px-3 py-3">{clientTypeLabel(lead.clientType)}</td>
                <td className="px-3 py-3"><select className="focus-input min-w-40" value={lead.status} disabled={busy === lead.id} onChange={(event) => updateLead(lead.id, { status: event.target.value })}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                <td className="px-3 py-3"><select className="focus-input min-w-36" value={activity.actionType} onChange={(event) => setActivityByLead((current) => ({ ...current, [lead.id]: { ...activity, actionType: event.target.value } }))}>{actionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                <td className="px-3 py-3">{lead.contactName || lead.contacts?.[0]?.name || "-"}<small className="block text-slate-400">{[lead.contacts?.[0]?.role, lead.phone, lead.email].filter(Boolean).join(" / ")}</small></td>
                <td className="px-3 py-3 min-w-72"><textarea className="focus-input min-h-20" value={activity.details} onChange={(event) => setActivityByLead((current) => ({ ...current, [lead.id]: { ...activity, details: event.target.value } }))} placeholder={latest?.details || lead.notes || "Adauga activitate"} /><button className="focus-button secondary mt-2" type="button" disabled={busy === `activity-${lead.id}`} onClick={() => addActivity(lead)}><Save size={16} /> Salveaza activitate</button></td>
                <td className="px-3 py-3 min-w-52"><input className="focus-input" value={activity.locations} onChange={(event) => setActivityByLead((current) => ({ ...current, [lead.id]: { ...activity, locations: event.target.value } }))} /></td>
                <td className="px-3 py-3"><input className="focus-input min-w-36" type="date" value={activity.nextFollowUpDate} onChange={(event) => setActivityByLead((current) => ({ ...current, [lead.id]: { ...activity, nextFollowUpDate: event.target.value } }))} /><small className="mt-2 block text-slate-400"><CalendarClock className="mr-1 inline h-3 w-3" />{lead.nextFollowUpDate ? date(lead.nextFollowUpDate) : "nesetat"}</small></td>
              </tr>;
            }) : <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={9}>Nu exista lead-uri pentru filtrul curent.</td></tr>}</tbody>
          </table>
        </div>
      </section>
    </div>
  </main>;
}

function clientTypeLabel(value?: string | null) {
  if (value === "agency") return "Agentie";
  if (value === "direct_client") return "Client Direct";
  return "-";
}

function Feedback({ tone, text }: { tone: "green" | "red"; text: string }) {
  return <p className={`rounded-lg border px-4 py-3 text-sm font-bold ${tone === "green" ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-red-300/30 bg-red-500/10 text-red-100"}`}>{text}</p>;
}

function date(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
