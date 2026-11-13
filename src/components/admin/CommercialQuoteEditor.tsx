"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Quote, Workspace, Run } from "@/components/admin/CommercialWorkbench";
import type { LocationSelectionAvailability, LocationSelectionLocationDTO } from "@/lib/location-selection-dto";
import { readQuoteSelectionDraft, saveQuoteSelectionDraft, type QuoteSelectionDraft } from "@/lib/quote-selection-bridge";

const inputClass = "focus-input min-w-0 w-full";
const normalized = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid min-w-0 gap-1 text-sm font-bold text-slate-300"><span>{label}</span>{children}</label>;
}

export function CommercialQuoteEditor({ data, quote, run, busy, onSaved }: { data: Workspace; quote?: Quote; run: Run; busy: boolean; onSaved: (quoteId: string) => void }) {
  const old = quote?.revisions[0]?.payload;
  const [seed, setSeed] = useState<QuoteSelectionDraft | null>(null);
  const [seedNotice, setSeedNotice] = useState("");
  const [clientId, setClientId] = useState(old?.clientId || "");
  const [campaignId, setCampaignId] = useState(old?.campaignId || "");
  const [opportunityId, setOpportunityId] = useState("");
  const [recipient, setRecipient] = useState(old?.recipient || "");
  const [entity, setEntity] = useState(old?.companyEntity || "");
  const [from, setFrom] = useState(old?.periodStart || "");
  const [to, setTo] = useState(old?.periodEnd || "");
  const [selected, setSelected] = useState<string[]>(old?.lines.map((line) => line.locationId) || []);
  const [rates, setRates] = useState<Record<string, string>>(Object.fromEntries(old?.lines.map((line) => [line.locationId, line.monthlyRate]) || []));
  const [reasons, setReasons] = useState<Record<string, string>>(Object.fromEntries(old?.lines.map((line) => [line.locationId, line.pricingReason || ""]) || []));
  const [search, setSearch] = useState("");
  const [availableOnly, setAvailableOnly] = useState(true);
  const [metadata, setMetadata] = useState<Record<string, LocationSelectionLocationDTO>>({});
  const [availability, setAvailability] = useState<Record<string, LocationSelectionAvailability>>({});
  const [checking, setChecking] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [localError, setLocalError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [requestKey] = useState(() => crypto.randomUUID());
  const userId = data.userId;
  const locations = data.locations.filter((row) => !/digital|led|ecran|screen|lcd|display|dooh/i.test(row.type || ""));
  const locationKey = locations.map((row) => row.id).sort().join("|");
  const validPeriod = Boolean(from && to && from <= to);
  const client = data.clients.find((row) => row.id === clientId);
  const campaign = data.campaigns.find((row) => row.id === campaignId && row.clientId === clientId);

  useEffect(() => {
    if (old) return;
    const params = new URLSearchParams(window.location.search);
    const seedKey = params.get("selection");
    const draft = seedKey && userId ? readQuoteSelectionDraft(seedKey, userId) : null;
    if (seedKey && !draft) setSeedNotice("Selecția transferată a expirat sau nu aparține acestui cont. Poți construi o ofertă nouă.");
    if (draft) {
      setSeed(draft); setFrom(draft.periodStart); setTo(draft.periodEnd); setSelected(draft.locationIds); setEntity(draft.companyEntity);
      setSeedNotice(`${draft.locationIds.length} locații și perioada au fost preluate din selector. Verifică clientul și campania înainte de salvare.`);
    }
    const matchingClients = draft?.clientName ? data.clients.filter((row) => normalized(row.companyName) === normalized(draft.clientName)) : [];
    const proposedClient = params.get("clientId") || draft?.clientId || (matchingClients.length === 1 ? matchingClients[0].id : "");
    const verifiedClient = data.clients.find((row) => row.id === proposedClient);
    if (verifiedClient) { setClientId(verifiedClient.id); setRecipient(verifiedClient.primaryContact?.email || verifiedClient.generalEmail || ""); }
    const matchingCampaigns = draft?.campaignName ? data.campaigns.filter((row) => row.clientId === verifiedClient?.id && normalized(row.campaignName) === normalized(draft.campaignName)) : [];
    const proposedCampaign = params.get("campaignId") || draft?.campaignId || (matchingCampaigns.length === 1 ? matchingCampaigns[0].id : "");
    const verifiedCampaign = data.campaigns.find((row) => row.id === proposedCampaign && row.clientId === verifiedClient?.id);
    if (verifiedCampaign) { setCampaignId(verifiedCampaign.id); if (!draft && verifiedCampaign.companyEntity) setEntity(verifiedCampaign.companyEntity); if (!draft && verifiedCampaign.startDate) setFrom(verifiedCampaign.startDate.slice(0, 10)); if (!draft && verifiedCampaign.endDate) setTo(verifiedCampaign.endDate.slice(0, 10)); }
    const proposedOpportunity = params.get("opportunityId") || draft?.opportunityId;
    if (proposedOpportunity && data.opportunities.some((row) => row.id === proposedOpportunity)) setOpportunityId(proposedOpportunity);
    // This editor is keyed for a new intention; later refreshes must not erase input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/location-selection", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      if (Array.isArray(body.locations)) setMetadata(Object.fromEntries(body.locations.map((row: LocationSelectionLocationDTO) => [row.id, row])));
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setAvailability({}); setAvailabilityError("");
    if (!validPeriod || !locationKey) { setChecking(false); return; }
    const controller = new AbortController();
    setChecking(true);
    const timer = window.setTimeout(async () => {
      try {
        const ids = locationKey.split("|");
        const pages = Array.from({ length: Math.ceil(ids.length / 500) }, (_, index) => ids.slice(index * 500, (index + 1) * 500));
        const results = await Promise.all(pages.map(async (locationIds) => {
          const response = await fetch("/api/admin/location-selection/availability", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ locationIds, periodStart: from, periodEnd: to }) });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "Disponibilitatea nu poate fi verificată.");
          return body.availabilityByLocationId as Record<string, LocationSelectionAvailability>;
        }));
        if (!controller.signal.aborted) setAvailability(Object.assign({}, ...results));
      } catch (cause) {
        if (!controller.signal.aborted) setAvailabilityError(cause instanceof Error ? cause.message : "Disponibilitatea nu poate fi verificată.");
      } finally { if (!controller.signal.aborted) setChecking(false); }
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [from, to, validPeriod, locationKey, refresh]);

  const shown = useMemo(() => locations.filter((row) => {
    const meta = metadata[row.id];
    return (!search || normalized([row.code, row.city, meta?.area, meta?.address, meta?.name].join(" ")).includes(normalized(search)))
      && (!availableOnly || !validPeriod || checking || selected.includes(row.id) || availability[row.id]?.state === "AVAILABLE");
  }), [locations, metadata, search, availableOnly, validPeriod, checking, selected, availability]);
  const missingLocations = selected.filter((id) => !locations.some((row) => row.id === id));
  const selectedRows = selected.flatMap((id) => locations.find((row) => row.id === id) || []);
  const unavailable = validPeriod ? selected.filter((id) => availability[id]?.state !== "AVAILABLE") : [];
  const totalMonthly = selectedRows.reduce((sum, row) => sum + Number(String(rates[row.id] ?? row.rateCardValue ?? 0).replace(",", ".")), 0);
  const blocked = !clientId || !campaign || !campaign.currency || campaign.currency !== data.policy?.rateCardCurrency || !campaign.companyEntity || entity !== campaign.companyEntity || !validPeriod || !selected.length || selected.length > 50 || checking || Boolean(availabilityError) || unavailable.length > 0 || missingLocations.length > 0;

  function changeClient(id: string) { setClientId(id); setCampaignId(""); const selectedClient = data.clients.find((row) => row.id === id); setRecipient(selectedClient?.primaryContact?.email || selectedClient?.generalEmail || ""); }
  function changeCampaign(id: string) { setCampaignId(id); const selectedCampaign = data.campaigns.find((row) => row.id === id); if (selectedCampaign?.companyEntity) setEntity(selectedCampaign.companyEntity); if (!from && selectedCampaign?.startDate) setFrom(selectedCampaign.startDate.slice(0, 10)); if (!to && selectedCampaign?.endDate) setTo(selectedCampaign.endDate.slice(0, 10)); }
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  function openMap() {
    setLocalError("");
    try {
      const key = saveQuoteSelectionDraft({ ownerUserId: userId, createdAt: Date.now(), clientId: clientId || undefined, campaignId: campaignId || undefined, opportunityId: opportunityId || undefined, clientName: client?.companyName || "", campaignName: campaign?.campaignName || "", companyEntity: entity, periodStart: from, periodEnd: to, locationIds: selected });
      window.location.assign(`/admin/selectie-locatii?selection=${encodeURIComponent(key)}`);
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "Completează perioada și selectează cel puțin o locație."); }
  }

  return <form className="mt-4 grid min-w-0 gap-5" onSubmit={async (event) => {
    event.preventDefault(); setLocalError("");
    if (blocked) { setLocalError("Verifică clientul, moneda campaniei, perioada și disponibilitatea locațiilor."); return; }
    const linePrices = selectedRows.flatMap((row) => {
      const monthlyRate = rates[row.id];
      if (monthlyRate == null || Number(monthlyRate) === row.rateCardValue) return [];
      return [{ locationId: row.id, monthlyRate: monthlyRate.replace(",", "."), reason: reasons[row.id] || "" }];
    });
    if (linePrices.some((line) => !/^\d+(\.\d{1,2})?$/.test(line.monthlyRate) || Number(line.monthlyRate) <= 0 || line.reason.trim().length < 3)) {
      setLocalError("Fiecare preț negociat trebuie să fie pozitiv, cu maximum două zecimale și o justificare de minimum 3 caractere."); return;
    }
    const result = await run("quote.create", { ...(quote ? { quoteId: quote.id, expectedRevision: quote.latestRevision } : {}), clientId, campaignId, ...(opportunityId ? { opportunityId } : {}), recipient, companyEntity: entity, periodStart: from, periodEnd: to, locationIds: selected, ...(linePrices.length ? { linePrices } : {}), assumptions: String(new FormData(event.currentTarget).get("assumptions") || ""), requestKey });
    if (result && typeof result === "object" && "quote" in result) { const saved = result as { quote: { id: string } }; onSaved(saved.quote.id); }
  }}>
    {seedNotice ? <p role="status" className="rounded-lg border border-focus-yellow/35 p-3 text-sm text-slate-200">{seedNotice}</p> : null}
    <fieldset className="grid min-w-0 gap-3 md:grid-cols-2" disabled={busy}>
      <legend className="mb-3 font-bold text-white">1. Client și condiții comerciale</legend>
      <Field label="Client"><select required className={inputClass} value={clientId} onChange={(event) => changeClient(event.target.value)}><option value="">Selectează clientul</option>{data.clients.map((row) => <option value={row.id} key={row.id}>{row.companyName}</option>)}</select></Field>
      <Field label="Campanie și monedă"><select required className={inputClass} value={campaignId} onChange={(event) => changeCampaign(event.target.value)}><option value="">Selectează campania</option>{data.campaigns.filter((row) => row.clientId === clientId).map((row) => <option key={row.id} value={row.id}>{row.campaignName} · {row.currency || "monedă de completat"}</option>)}</select></Field>
      <p className="text-xs text-slate-400 md:col-span-2">Lipsește dosarul? <Link className="text-focus-yellow underline" href="/admin/clienti">Deschide clienții</Link> sau <Link className="text-focus-yellow underline" href={`/admin/campanii?create=1${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ""}`}>creează campania</Link>. Selecția transferată rămâne disponibilă în această filă timp de 30 de minute.</p>
      {campaign && !campaign.currency ? <p role="alert" className="text-sm font-bold text-amber-200 md:col-span-2">Completează moneda în <Link className="underline" href={`/admin/campanii?campaignId=${encodeURIComponent(campaign.id)}`}>dosarul campaniei</Link> înainte de ofertare.</p> : null}
      {campaign && (!campaign.companyEntity || entity !== campaign.companyEntity) ? <p role="alert" className="text-sm text-amber-200 md:col-span-2">Firma trebuie să corespundă dosarului campaniei. Verifică <Link className="underline" href={`/admin/campanii?campaignId=${encodeURIComponent(campaign.id)}`}>entitatea contractuală</Link>.</p> : null}
      {campaign?.currency && data.policy?.rateCardCurrency !== campaign.currency ? <p role="alert" className="text-sm font-bold text-amber-200 md:col-span-2">Moneda campaniei diferă de tarifele de listă. Este necesară clarificarea comercială; aplicația nu presupune un curs valutar.</p> : null}
      <Field label="E-mail destinatar"><input type="email" required maxLength={254} className={inputClass} value={recipient} onChange={(event) => setRecipient(event.target.value)} /></Field>
      <Field label="Firma contractantă"><select required className={inputClass} value={entity} onChange={(event) => setEntity(event.target.value)}><option value="">Alege firma</option><option>Focus Media</option><option>Excellence Media</option><option>Focus BG / Focus Media LLC EOOD</option></select></Field>
      <Field label="Prima zi inclusă"><input type="date" required className={inputClass} value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
      <Field label="Ultima zi inclusă"><input type="date" required min={from || undefined} className={inputClass} value={to} onChange={(event) => setTo(event.target.value)} /></Field>
    </fieldset>
    <fieldset className="min-w-0" disabled={busy}>
      <legend className="mb-3 font-bold text-white">2. Amplasamente disponibile pentru această perioadă</legend>
      <div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1"><Field label="Caută locații"><input className={inputClass} placeholder="Cod, oraș, zonă sau adresă" value={search} onChange={(event) => setSearch(event.target.value)} /></Field></div><button className="focus-button secondary" type="button" onClick={openMap} disabled={!validPeriod || !selected.length}>Deschide selecția pe hartă</button></div>
      <div className="my-3 flex flex-wrap items-center justify-between gap-3 text-sm"><label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} />Doar disponibile pe întreaga perioadă</label><span className="font-bold text-white">{selected.length} selectate / maximum 50</span></div>
      {!validPeriod ? <p className="mb-3 text-sm text-amber-200">Alege perioada pentru verificarea disponibilității.</p> : checking ? <p role="status" className="mb-3 text-sm text-slate-300">Se verifică disponibilitatea…</p> : availabilityError ? <div role="alert" className="mb-3 text-sm text-red-200">{availabilityError}<button className="ml-3 underline" type="button" onClick={() => setRefresh((value) => value + 1)}>Reîncearcă</button></div> : <p className="mb-3 text-xs text-slate-400">Disponibilitatea va fi verificată din nou la salvare, aprobare și rezervare.</p>}
      <div className="grid max-h-[26rem] gap-2 overflow-y-auto rounded-lg border border-focus-line p-2 sm:grid-cols-2">
        {shown.map((row) => { const checked = selected.includes(row.id); const info = availability[row.id]; const meta = metadata[row.id]; const disabled = !checked && (!validPeriod || checking || info?.state !== "AVAILABLE" || selected.length >= 50); return <label key={row.id} className={`flex min-w-0 gap-3 rounded-lg border p-3 ${checked ? "border-focus-yellow bg-focus-yellow/5" : "border-focus-line"} ${disabled ? "opacity-65" : "cursor-pointer"}`}><input className="mt-1 shrink-0" type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(row.id)} />{meta?.thumbnail ? <img className="h-16 w-20 shrink-0 rounded object-cover" src={meta.thumbnail} alt={`Locația ${row.code}`} loading="lazy" /> : null}<span className="min-w-0"><strong className="block break-words text-white">{row.code} · {row.city || "Oraș nesetat"}</strong><small className="block break-words text-slate-400">{meta?.area || meta?.address || row.type}</small><small className="block text-slate-300">Listă: {row.rateCardValue ?? "preț lipsă"} {data.policy?.rateCardCurrency || "monedă nesetată"}/lună</small><small className={`block ${info?.state === "AVAILABLE" ? "text-emerald-200" : "text-amber-200"}`}>{checking ? "Se verifică…" : info?.label || "Disponibilitate neverificată"}</small>{checked && info?.state !== "AVAILABLE" && info?.explanation ? <small className="block break-words text-red-200">{info.explanation}</small> : null}</span></label>; })}
        {!shown.length ? <p className="p-3 text-sm text-slate-300">Nu există locații pentru căutarea și perioada selectate. Poți modifica filtrele.</p> : null}
      </div>
      {missingLocations.length ? <p role="alert" className="mt-3 text-sm text-red-200">{missingLocations.length} locații din selecție nu mai sunt ofertabile. <button type="button" className="underline" onClick={() => setSelected((current) => current.filter((id) => !missingLocations.includes(id)))}>Elimină locațiile lipsă</button></p> : null}
    </fieldset>
    {selectedRows.length ? <fieldset className="grid gap-3" disabled={busy}><legend className="mb-3 font-bold text-white">3. Tarife propuse și negociere</legend>{selectedRows.map((row) => {
      const value = rates[row.id] ?? String(row.rateCardValue ?? ""); const negotiated = value !== "" && Number(value.replace(",", ".")) !== row.rateCardValue; const discount = row.rateCardValue && value ? (1 - Number(value.replace(",", ".")) / row.rateCardValue) * 100 : null;
      return <div className="grid min-w-0 gap-3 rounded-lg border border-focus-line p-3 md:grid-cols-[minmax(0,1fr)_minmax(160px,220px)]" key={row.id}><div><strong className="text-white">{row.code}</strong><p className="text-xs text-slate-400">Tarif de listă: {row.rateCardValue ?? "lipsă"} {campaign?.currency || data.policy?.rateCardCurrency}/lună{discount !== null && negotiated ? ` · ${discount >= 0 ? "discount" : "majorare"} ${Math.abs(discount).toFixed(2)}%` : ""}</p></div><Field label={`Tarif lunar propus ${row.code}`}><input required inputMode="decimal" className={inputClass} value={value} onChange={(event) => setRates((current) => ({ ...current, [row.id]: event.target.value }))} /></Field>{negotiated ? <div className="md:col-span-2"><Field label={`Justificare negociere ${row.code}`}><input required minLength={3} maxLength={500} className={inputClass} value={reasons[row.id] || ""} onChange={(event) => setReasons((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Ex.: pachet 6 luni, ofertă supusă aprobării" /></Field><p className="mt-1 text-xs text-amber-200">Prețul negociat păstrează tariful de listă și necesită aprobarea unui responsabil comercial.</p></div> : null}</div>;
    })}<p className="text-sm font-bold text-white">Total lunar propus: {totalMonthly.toLocaleString("ro-RO", { maximumFractionDigits: 2 })} {campaign?.currency || data.policy?.rateCardCurrency}</p><p className="text-xs text-slate-400">Calculul pentru perioada exactă, TVA și totalul final se confirmă pe server după salvarea ciornei.</p></fieldset> : null}
    <Field label="Condiții și observații pentru revizuire"><textarea maxLength={2000} rows={3} name="assumptions" className={inputClass} defaultValue={old?.assumptions || ""} /></Field>
    {localError ? <p role="alert" className="text-sm font-bold text-red-200">{localError}</p> : null}
    {unavailable.length > 0 && validPeriod && !checking && !availabilityError ? <p role="alert" className="text-sm text-amber-200">{unavailable.length} locații selectate nu sunt disponibile integral sau nu au fost verificate. Modifică selecția sau perioada.</p> : null}
    <div className="flex flex-wrap items-center gap-3"><button type="submit" className="focus-button" disabled={busy || blocked}>{busy ? "Se salvează…" : quote ? "Salvează versiunea nouă" : "Salvează ciorna ofertei"}</button><p className="text-xs text-slate-400">Ciorna nu rezervă locațiile și nu trimite mesaje clientului.</p></div>
  </form>;
}
