"use client";

import { Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import { MEDIA_TYPE_OPTIONS } from "@/lib/format";
import type { CategoryDTO, LocationDTO, LocationStatus } from "@/types/location";

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
  latReal: string;
  lngReal: string;
  latDisplay: string;
  lngDisplay: string;
  mapsUrl: string;
  mainPhotoUrl: string;
  imageUrls: string;
  showPricePublic: boolean;
  showInstallationCostPublic: boolean;
  showInPublic: boolean;
  isPremium: boolean;
  isFeatured: boolean;
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
          <Text label="Rate Card" value={state.rateCard} onChange={(value) => update("rateCard", value)} />
          <Text label="Rate numeric EUR" type="number" value={state.rateCardValue} onChange={(value) => update("rateCardValue", value)} />
          <Text
            label="Montare/neutralizare"
            value={state.installationRemoval}
            onChange={(value) => update("installationRemoval", value)}
          />
          <Text
            label="Install numeric"
            type="number"
            value={state.installationRemovalValue}
            onChange={(value) => update("installationRemovalValue", value)}
          />
          <Text label="Disponibilitate" value={state.availabilityText} onChange={(value) => update("availabilityText", value)} />
          <Text label="Disponibil din" type="date" value={state.availableFrom} onChange={(value) => update("availableFrom", value)} />
          <Text label="Disponibil pana la" type="date" value={state.availableUntil} onChange={(value) => update("availableUntil", value)} />
          <Text label="Inchiriat/rezervat din" type="date" value={state.bookedFrom} onChange={(value) => update("bookedFrom", value)} />
          <Text label="Inchiriat/rezervat pana la" type="date" value={state.bookedUntil} onChange={(value) => update("bookedUntil", value)} />
          <label className="grid gap-2">
            <span className="text-sm font-bold">Status</span>
            <select className="focus-input" value={state.status} onChange={(event) => update("status", event.target.value as LocationStatus)}>
              <option value="AVAILABLE">AVAILABLE</option>
              <option value="AVAILABLE_FROM">AVAILABLE_FROM</option>
              <option value="BOOKED">BOOKED</option>
              <option value="RESERVED">RESERVED</option>
              <option value="UNKNOWN">UNKNOWN</option>
            </select>
          </label>
          <Text label="latReal" type="number" value={state.latReal} onChange={(value) => update("latReal", value)} />
          <Text label="lngReal" type="number" value={state.lngReal} onChange={(value) => update("lngReal", value)} />
          <Text label="latDisplay" type="number" value={state.latDisplay} onChange={(value) => update("latDisplay", value)} />
          <Text label="lngDisplay" type="number" value={state.lngDisplay} onChange={(value) => update("lngDisplay", value)} />
          <Text label="Maps URL" value={state.mapsUrl} onChange={(value) => update("mapsUrl", value)} />
          <Text label="Poza principala URL" value={state.mainPhotoUrl} onChange={(value) => update("mainPhotoUrl", value)} />
        </div>

        <Textarea
          label="Linkuri galerie foto"
          value={state.imageUrls}
          onChange={(value) => update("imageUrls", value)}
        />

        <label className="grid gap-2">
          <span className="text-sm font-bold">Adresa / descriere locatie</span>
          <textarea className="focus-input min-h-24" value={state.address} onChange={(event) => update("address", event.target.value)} />
        </label>

        <div className="grid gap-4 md:grid-cols-3">
          <Textarea label="Avantaje locatie" value={state.benefits} onChange={(value) => update("benefits", value)} />
          <Textarea label="Detalii media" value={state.mediaDetails} onChange={(value) => update("mediaDetails", value)} />
          <Textarea label="Detalii campanie" value={state.campaignDetails} onChange={(value) => update("campaignDetails", value)} />
        </div>

        <Textarea label="Note interne" value={state.internalNotes} onChange={(value) => update("internalNotes", value)} />

        <div className="grid gap-2 md:grid-cols-4">
          <Toggle label="Iluminat" checked={state.illum} onChange={(value) => update("illum", value)} />
          <Toggle label="Arata pret public" checked={state.showPricePublic} onChange={(value) => update("showPricePublic", value)} />
          <Toggle
            label="Arata montarea public"
            checked={state.showInstallationCostPublic}
            onChange={(value) => update("showInstallationCostPublic", value)}
          />
          <Toggle label="Vizibil public" checked={state.showInPublic} onChange={(value) => update("showInPublic", value)} />
          <Toggle label="Premium" checked={state.isPremium} onChange={(value) => update("isPremium", value)} />
          <Toggle label="Featured in hero" checked={state.isFeatured} onChange={(value) => update("isFeatured", value)} />
        </div>

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
    latReal: location?.latReal?.toString() || "",
    lngReal: location?.lngReal?.toString() || "",
    latDisplay: location?.latDisplay?.toString() || "",
    lngDisplay: location?.lngDisplay?.toString() || "",
    mapsUrl: location?.mapsUrl || "",
    mainPhotoUrl: location?.photoOriginalUrl || location?.mainPhotoUrl || "",
    imageUrls: location?.images.map((image) => image.url).join("\n") || "",
    showPricePublic: location?.showPricePublic || false,
    showInstallationCostPublic: location?.showInstallationCostPublic || false,
    showInPublic: location?.showInPublic ?? true,
    isPremium: location?.isPremium || false,
    isFeatured: location?.isFeatured || false,
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
    latReal: numberOrNull(state.latReal),
    lngReal: numberOrNull(state.lngReal),
    latDisplay: numberOrNull(state.latDisplay),
    lngDisplay: numberOrNull(state.lngDisplay),
    mapsUrl: nullable(state.mapsUrl),
    mainPhotoUrl: nullable(state.mainPhotoUrl),
    imageUrls: lines(state.imageUrls),
    showPricePublic: state.showPricePublic,
    showInstallationCostPublic: state.showInstallationCostPublic,
    showInPublic: state.showInPublic,
    isPremium: state.isPremium,
    isFeatured: state.isFeatured,
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
