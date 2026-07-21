"use client";

import { Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import { MEDIA_TYPE_OPTIONS } from "@/lib/format";
import type { CategoryDTO, GpsAuditStatus, LocationDTO, LocationLifecycleStatus, LocationStatus } from "@/types/location";

type EditorState = {
  id?: string;
  code: string;
  nr: string;
  categoryName: string;
  city: string;
  county: string;
  address: string;
  type: string;
  size: string;
  sqm: string;
  illum: boolean;
  rateCard: string;
  rateCardValue: string;
  installationRemoval: string;
  installationRemovalValue: string;
  availabilityText: string;
  availableFrom: string;
  availableUntil: string;
  bookedFrom: string;
  bookedUntil: string;
  status: LocationStatus;
  lifecycleStatus: LocationLifecycleStatus;
  latReal: string;
  lngReal: string;
  latDisplay: string;
  lngDisplay: string;
  mapsUrl: string;
  mainPhotoUrl: string;
  imageUrls: string;
  productionSketchUrl: string;
  showPricePublic: boolean;
  showInstallationCostPublic: boolean;
  showInPublic: boolean;
  isPremium: boolean;
  isFeatured: boolean;
  normalizedLocationName: string;
  reportingGroupName: string;
  displayOrder: string;
  locationGroupOrder: string;
  faceOrder: string;
  directionOrder: string;
  monthlyCost: string;
  costCurrency: string;
  costType: string;
  costSupplier: string;
  costNotes: string;
  blockedReason: string;
  blockedFrom: string;
  blockedUntil: string;
  blockedNotes: string;
  coordinateSource: string;
  gpsAuditStatus: GpsAuditStatus;
  benefits: string;
  mediaDetails: string;
  campaignDetails: string;
  internalNotes: string;
};

export function LocationEditor({
  location,
  categories,
  onClose,
  onSaved
}: {
  location?: LocationDTO | null;
  categories: CategoryDTO[];
  onClose: () => void;
  onSaved: (location: LocationDTO) => void;
}) {
  const initial = useMemo(() => toEditorState(location, categories[0]?.name || "General"), [location, categories]);
  const [state, setState] = useState<EditorState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const galleryUrls = useMemo(() => lines(state.imageUrls), [state.imageUrls]);

  function update<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    setState((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = toPayload(state);
    const response = await fetch(state.id ? `/api/locations/${state.id}` : "/api/locations", {
      method: state.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSaving(false);

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.error || "Nu am putut salva locatia.");
      return;
    }

    onSaved(data.location);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/70 p-4 backdrop-blur">
      <section className="focus-card mx-auto grid max-w-5xl gap-5 rounded-lg p-5">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">{state.id ? "Editare locatie" : "Locatie noua"}</p>
            <h2 className="font-display text-3xl font-black uppercase">{state.code || "Locatie noua"}</h2>
          </div>
          <button className="focus-button secondary" type="button" onClick={onClose}>
            <X size={18} />
            Inchide
          </button>
        </header>

        {error ? <p className="rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-100">{error}</p> : null}

        <EditorSection title="Overview" defaultOpen>
          <div className="grid gap-4 md:grid-cols-3">
            <Text label="Cod" value={state.code} onChange={(value) => update("code", value)} />
            <Text label="Nr" value={state.nr} onChange={(value) => update("nr", value)} />
            <label className="grid gap-2">
              <span className="text-sm font-bold">Categorie</span>
              <input
                className="focus-input"
                list="category-list"
                value={state.categoryName}
                onChange={(event) => update("categoryName", event.target.value)}
              />
              <datalist id="category-list">
                {categories.map((category) => (
                  <option key={category.id} value={category.name} />
                ))}
              </datalist>
            </label>
            <Text label="Oras / zona" value={state.city} onChange={(value) => update("city", value)} />
            <Text label="Judet" value={state.county} onChange={(value) => update("county", value)} />
            <label className="grid gap-2">
              <span className="text-sm font-bold">Format media</span>
              <select className="focus-input" value={state.type} onChange={(event) => update("type", event.target.value)}>
                <option value="">Alege formatul</option>
                {MEDIA_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <Text label="Dimensiune" value={state.size} onChange={(value) => update("size", value)} />
            <Text label="SQM" type="number" value={state.sqm} onChange={(value) => update("sqm", value)} />
            <Toggle label="Iluminat" checked={state.illum} onChange={(value) => update("illum", value)} />
          </div>
          <label className="mt-4 grid gap-2">
            <span className="text-sm font-bold">Adresa / descriere locatie</span>
            <textarea className="focus-input min-h-24" value={state.address} onChange={(event) => update("address", event.target.value)} />
          </label>
          <Textarea label="Descriere publica scurta / avantaje" value={state.benefits} onChange={(value) => update("benefits", value)} />
        </EditorSection>

        <EditorSection title="Comercial">
          <PublicImpactNotice />
          <div className="grid gap-4 md:grid-cols-3">
            <Text label="Rate Card" value={state.rateCard} onChange={(value) => update("rateCard", value)} />
            <Text label="Rate numeric EUR" type="number" value={state.rateCardValue} onChange={(value) => update("rateCardValue", value)} />
            <Text label="Montare/neutralizare" value={state.installationRemoval} onChange={(value) => update("installationRemoval", value)} />
            <Text label="Install numeric" type="number" value={state.installationRemovalValue} onChange={(value) => update("installationRemovalValue", value)} />
            <Toggle label="Arata pret public" checked={state.showPricePublic} onChange={(value) => update("showPricePublic", value)} />
            <Toggle label="Arata montarea public" checked={state.showInstallationCostPublic} onChange={(value) => update("showInstallationCostPublic", value)} />
            <Toggle label="Vizibil public" checked={state.showInPublic} onChange={(value) => update("showInPublic", value)} />
            <Toggle label="Premium" checked={state.isPremium} onChange={(value) => update("isPremium", value)} />
            <Toggle label="Featured in hero" checked={state.isFeatured} onChange={(value) => update("isFeatured", value)} />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Textarea label="Detalii media" value={state.mediaDetails} onChange={(value) => update("mediaDetails", value)} />
            <Textarea label="Detalii campanie" value={state.campaignDetails} onChange={(value) => update("campaignDetails", value)} />
          </div>
        </EditorSection>

        <EditorSection title="Disponibilitate">
          <p className="rounded-lg border border-focus-line bg-focus-navy/40 p-3 text-sm font-bold text-slate-300">
            Disponibilitatea comerciala se calculeaza din rezervari si blocaje manuale. Blocajul comercial se administreaza din Detalii locatie, prin controlul canonic dedicat.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-bold">Stare locatie</span>
              <select className="focus-input" value={state.lifecycleStatus} onChange={(event) => update("lifecycleStatus", event.target.value as LocationLifecycleStatus)}>
                <option value="ACTIVE">Activa</option>
                <option value="INACTIVE">Inactiva</option>
                <option value="ARCHIVED">Arhivata</option>
                <option value="MAINTENANCE">Mentenanta</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-bold">Status disponibilitate vechi</span>
              <select className="focus-input" value={state.status} onChange={(event) => update("status", event.target.value as LocationStatus)}>
                <option value="AVAILABLE">Disponibila</option>
                <option value="AVAILABLE_FROM">Disponibila dintr-o data</option>
                <option value="BOOKED">Rezervata (legacy)</option>
                <option value="RESERVED">HOLD (legacy)</option>
                <option value="UNKNOWN">De verificat</option>
              </select>
            </label>
            <Text label="Disponibil din" type="date" value={state.availableFrom} onChange={(value) => update("availableFrom", value)} />
            <Text label="Disponibil pana la" type="date" value={state.availableUntil} onChange={(value) => update("availableUntil", value)} />
            <Text label="Inchiriat/rezervat din" type="date" value={state.bookedFrom} onChange={(value) => update("bookedFrom", value)} />
            <Text label="Inchiriat/rezervat pana la" type="date" value={state.bookedUntil} onChange={(value) => update("bookedUntil", value)} />
          </div>
          <p className="text-xs font-semibold text-slate-400">
            Statusul vechi ramane pentru compatibilitate cu importurile si datele existente. Disponibilitatea reala pentru vanzari se calculeaza din rezervari si blocaje.
          </p>
          <Textarea label="Text disponibilitate" value={state.availabilityText} onChange={(value) => update("availabilityText", value)} />
        </EditorSection>

        <EditorSection title="Galerie / Poze">
          <Text label="Poza principala URL" value={state.mainPhotoUrl} onChange={(value) => update("mainPhotoUrl", value)} />
          <Textarea label="Linkuri galerie foto" value={state.imageUrls} onChange={(value) => update("imageUrls", value)} />
          <Text label="Schita de productie URL" value={state.productionSketchUrl} onChange={(value) => update("productionSketchUrl", value)} />
          <SketchPreview url={state.productionSketchUrl} code={state.code} />
          <GalleryPreview mainUrl={state.mainPhotoUrl} imageUrls={galleryUrls} code={state.code} />
        </EditorSection>

        <EditorSection title="Operational">
          <PublicImpactNotice />
          <div className="grid gap-4 md:grid-cols-3">
            <Text label="latDisplay" type="number" value={state.latDisplay} onChange={(value) => update("latDisplay", value)} />
            <Text label="lngDisplay" type="number" value={state.lngDisplay} onChange={(value) => update("lngDisplay", value)} />
            <Text label="Maps URL" value={state.mapsUrl} onChange={(value) => update("mapsUrl", value)} />
            <Text label="Sursa coordonate" value={state.coordinateSource} onChange={(value) => update("coordinateSource", value)} />
            <label className="grid gap-2">
              <span className="text-sm font-bold">Audit GPS</span>
              <select className="focus-input" value={state.gpsAuditStatus} onChange={(event) => update("gpsAuditStatus", event.target.value as GpsAuditStatus)}>
                <option value="OK">OK</option>
                <option value="CORRECTED">CORRECTED</option>
                <option value="MISSING">MISSING</option>
                <option value="NEEDS_CONFIRMATION">NEEDS_CONFIRMATION</option>
                <option value="SUSPECT">SUSPECT</option>
              </select>
            </label>
          </div>
          <Textarea label="Note interne operationale" value={state.internalNotes} onChange={(value) => update("internalNotes", value)} />
        </EditorSection>

        <EditorSection title="Financiar">
          <p className="rounded-lg border border-focus-line bg-focus-navy/40 p-3 text-sm font-bold text-slate-300">
            Costurile de chirie/furnizor sunt pastrate aici pentru context. Pe termen lung, chiria trebuie legata de acordul cu furnizorul, iar printul, montajul si transportul trebuie sa stea pe campanie/operational.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <Text label="Cost furnizor / chirie locatie" type="number" value={state.monthlyCost} onChange={(value) => update("monthlyCost", value)} />
            <label className="grid gap-2">
              <span className="text-sm font-bold">Moneda cost</span>
              <select className="focus-input" value={state.costCurrency} onChange={(event) => update("costCurrency", event.target.value)}>
                <option value="">Nesetat</option>
                <option value="EUR">EUR</option>
                <option value="RON">RON</option>
              </select>
            </label>
            <Text label="Tip cost / acord" value={state.costType} onChange={(value) => update("costType", value)} />
            <Text label="Furnizor / proprietar cost" value={state.costSupplier} onChange={(value) => update("costSupplier", value)} />
          </div>
          <Textarea label="Note costuri / context financiar" value={state.costNotes} onChange={(value) => update("costNotes", value)} />
        </EditorSection>

        <EditorSection title="Documente / Istoric">
          <p className="rounded-lg border border-focus-line bg-focus-navy/40 p-3 text-sm font-bold text-slate-300">
            Documentele si istoricul/auditul raman in modulele dedicate. Nu se editeaza direct din acest formular.
          </p>
        </EditorSection>

        <EditorSection title="Setari avansate">
          <p className="mb-4 rounded-lg border border-amber-300/30 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
            Campurile de mai jos sunt tehnice sau private. Nu sunt afisate in portalul public.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <Text label="latReal" type="number" value={state.latReal} onChange={(value) => update("latReal", value)} />
            <Text label="lngReal" type="number" value={state.lngReal} onChange={(value) => update("lngReal", value)} />
            <Text label="Nume normalizat" value={state.normalizedLocationName} onChange={(value) => update("normalizedLocationName", value)} />
            <Text label="Grup raportare" value={state.reportingGroupName} onChange={(value) => update("reportingGroupName", value)} />
            <Text label="Ordine display" type="number" value={state.displayOrder} onChange={(value) => update("displayOrder", value)} />
            <Text label="Ordine grup locatie" type="number" value={state.locationGroupOrder} onChange={(value) => update("locationGroupOrder", value)} />
            <Text label="Ordine fata" type="number" value={state.faceOrder} onChange={(value) => update("faceOrder", value)} />
            <Text label="Ordine directie" type="number" value={state.directionOrder} onChange={(value) => update("directionOrder", value)} />
          </div>
        </EditorSection>

        <footer className="flex justify-end">
          <button className="focus-button" type="button" onClick={save} disabled={saving}>
            <Save size={18} />
            {saving ? "Se salveaza..." : "Salveaza locatia"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-bold">{label}</span>
      <input className="focus-input" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-bold">{label}</span>
      <textarea className="focus-input min-h-32" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-focus-line px-3 py-2">
      <span className="font-bold">{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function EditorSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="rounded-lg border border-focus-line bg-focus-ink/55 p-4" open={defaultOpen}>
      <summary className="cursor-pointer text-sm font-black uppercase text-focus-yellow">{title}</summary>
      <div className="mt-4 grid gap-4">{children}</div>
    </details>
  );
}

function PublicImpactNotice() {
  return (
    <p className="rounded-lg border border-amber-300/30 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
      Aceasta schimbare afecteaza portalul public: vizibilitatea, preturile, costul de montaj sau coordonatele afisate pot fi vazute de clienti.
    </p>
  );
}

function GalleryPreview({ mainUrl, imageUrls, code }: { mainUrl: string; imageUrls: string[]; code: string }) {
  const urls = [mainUrl, ...imageUrls].map((url) => url.trim()).filter(Boolean);
  const uniqueUrls = Array.from(new Set(urls));
  if (!uniqueUrls.length) {
    return <p className="rounded-lg border border-focus-line bg-focus-navy/40 p-4 text-sm font-bold text-slate-400">Nu exista poze pentru aceasta locatie.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {uniqueUrls.slice(0, 8).map((url, index) => (
        <figure className="rounded-lg border border-focus-line bg-focus-navy/45 p-2" key={url}>
          <img className="h-28 w-full rounded-md object-cover" src={url} alt={`${code || "Locatie"} poza ${index + 1}`} />
          <figcaption className="mt-2 text-xs font-bold text-slate-300">{index === 0 ? "Principala / prima poza" : `Galerie ${index}`}</figcaption>
        </figure>
      ))}
      {uniqueUrls.length > 8 ? <p className="text-xs font-bold text-slate-400">+{uniqueUrls.length - 8} poze suplimentare in lista de URL-uri.</p> : null}
    </div>
  );
}

function SketchPreview({ url, code }: { url: string; code: string }) {
  const safeUrl = url.trim();
  if (!safeUrl) {
    return (
      <p className="rounded-lg border border-focus-line bg-focus-navy/40 p-4 text-sm font-bold text-slate-400">
        Nu exista schita de productie pentru aceasta locatie.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-focus-line bg-focus-navy/45 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Schita de productie</p>
          <p className="text-sm font-bold text-slate-300">{code || "Locatie"} are o schita atasata.</p>
        </div>
        <a className="focus-button secondary !min-h-0 px-3 py-2 text-xs" href={safeUrl} target="_blank" rel="noreferrer">
          Deschide schita
        </a>
      </div>
    </div>
  );
}

function toEditorState(location: LocationDTO | null | undefined, fallbackCategory: string): EditorState {
  return {
    id: location?.id,
    code: location?.code || "",
    nr: location?.nr || "",
    categoryName: location?.categoryName || fallbackCategory,
    city: location?.city || "",
    county: location?.county || "",
    address: location?.address || "",
    type: location?.type || "",
    size: location?.size || "",
    sqm: location?.sqm?.toString() || "",
    illum: location?.illum || false,
    rateCard: location?.rateCard || "",
    rateCardValue: location?.rateCardValue?.toString() || "",
    installationRemoval: location?.installationRemoval || "",
    installationRemovalValue: location?.installationRemovalValue?.toString() || "",
    availabilityText: location?.availabilityText || "",
    availableFrom: toDateInput(location?.availableFrom),
    availableUntil: toDateInput(location?.availableUntil),
    bookedFrom: toDateInput(location?.bookedFrom),
    bookedUntil: toDateInput(location?.bookedUntil),
    status: location?.status || "UNKNOWN",
    lifecycleStatus: location?.lifecycleStatus || "ACTIVE",
    latReal: location?.latReal?.toString() || "",
    lngReal: location?.lngReal?.toString() || "",
    latDisplay: location?.latDisplay?.toString() || "",
    lngDisplay: location?.lngDisplay?.toString() || "",
    mapsUrl: location?.mapsUrl || "",
    mainPhotoUrl: location?.photoOriginalUrl || location?.mainPhotoUrl || "",
    imageUrls: location?.images.map((image) => image.url).join("\n") || "",
    productionSketchUrl: location?.productionSketchUrl || "",
    showPricePublic: location?.showPricePublic || false,
    showInstallationCostPublic: location?.showInstallationCostPublic || false,
    showInPublic: location?.showInPublic ?? true,
    isPremium: location?.isPremium || false,
    isFeatured: location?.isFeatured || false,
    normalizedLocationName: location?.normalizedLocationName || "",
    reportingGroupName: location?.reportingGroupName || "",
    displayOrder: location?.displayOrder?.toString() || "",
    locationGroupOrder: location?.locationGroupOrder?.toString() || "",
    faceOrder: location?.faceOrder?.toString() || "",
    directionOrder: location?.directionOrder?.toString() || "",
    monthlyCost: location?.monthlyCost?.toString() || "",
    costCurrency: location?.costCurrency || "",
    costType: location?.costType || "",
    costSupplier: location?.costSupplier || "",
    costNotes: location?.costNotes || "",
    blockedReason: location?.blockedReason || "",
    blockedFrom: toDateInput(location?.blockedFrom),
    blockedUntil: toDateInput(location?.blockedUntil),
    blockedNotes: location?.blockedNotes || "",
    coordinateSource: location?.coordinateSource || "",
    gpsAuditStatus: location?.gpsAuditStatus || "NEEDS_CONFIRMATION",
    benefits: location?.benefits.join("\n") || "",
    mediaDetails: location?.mediaDetails.join("\n") || "",
    campaignDetails: location?.campaignDetails.join("\n") || "",
    internalNotes: location?.internalNotes || ""
  };
}

function toPayload(state: EditorState) {
  return {
    code: state.code,
    nr: nullable(state.nr),
    categoryName: state.categoryName,
    city: nullable(state.city),
    county: nullable(state.county),
    address: nullable(state.address),
    type: nullable(state.type),
    size: nullable(state.size),
    sqm: numberOrNull(state.sqm),
    illum: state.illum,
    rateCard: nullable(state.rateCard),
    rateCardValue: numberOrNull(state.rateCardValue),
    installationRemoval: nullable(state.installationRemoval),
    installationRemovalValue: numberOrNull(state.installationRemovalValue),
    availabilityText: nullable(state.availabilityText),
    availableFrom: dateOrNull(state.availableFrom),
    availableUntil: dateOrNull(state.availableUntil),
    bookedFrom: dateOrNull(state.bookedFrom),
    bookedUntil: dateOrNull(state.bookedUntil),
    status: state.status,
    lifecycleStatus: state.lifecycleStatus,
    latReal: numberOrNull(state.latReal),
    lngReal: numberOrNull(state.lngReal),
    latDisplay: numberOrNull(state.latDisplay),
    lngDisplay: numberOrNull(state.lngDisplay),
    mapsUrl: nullable(state.mapsUrl),
    mainPhotoUrl: nullable(state.mainPhotoUrl),
    productionSketchUrl: nullable(state.productionSketchUrl),
    imageUrls: lines(state.imageUrls),
    showPricePublic: state.showPricePublic,
    showInstallationCostPublic: state.showInstallationCostPublic,
    showInPublic: state.showInPublic,
    isPremium: state.isPremium,
    isFeatured: state.isFeatured,
    normalizedLocationName: nullable(state.normalizedLocationName),
    reportingGroupName: nullable(state.reportingGroupName),
    displayOrder: numberOrNull(state.displayOrder),
    locationGroupOrder: numberOrNull(state.locationGroupOrder),
    faceOrder: numberOrNull(state.faceOrder),
    directionOrder: numberOrNull(state.directionOrder),
    monthlyCost: numberOrNull(state.monthlyCost),
    costCurrency: nullable(state.costCurrency),
    costType: nullable(state.costType),
    costSupplier: nullable(state.costSupplier),
    costNotes: nullable(state.costNotes),
    coordinateSource: nullable(state.coordinateSource),
    gpsAuditStatus: state.gpsAuditStatus,
    benefits: lines(state.benefits),
    mediaDetails: lines(state.mediaDetails),
    campaignDetails: lines(state.campaignDetails),
    internalNotes: nullable(state.internalNotes)
  };
}

function nullable(value: string) {
  return value.trim() || null;
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOrNull(value: string) {
  return value || null;
}

function toDateInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
