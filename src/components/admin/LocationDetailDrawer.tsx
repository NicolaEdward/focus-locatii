"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Copy, Download, Edit, ExternalLink, MapPin, Plus, X } from "lucide-react";
import { adminNewReservationHref, adminReservationHref } from "@/lib/admin-routes";
import { monthlyRate, oneTimeRate, sqm } from "@/lib/format";
import { mapsHref } from "@/lib/gps";
import type { AuthSession } from "@/lib/auth";
import type { AdminLocationListItemDTO, LocationDTO } from "@/types/location";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LocationAvailabilityControls, type ActiveLocationOverride } from "@/components/admin/inventory/LocationAvailabilityControls";

type LocationTimelineResponse = {
  location: LocationDTO;
  admin: {
    publicVisibility: {
      showInPublic: boolean;
      showPricePublic: boolean;
      showInstallationCostPublic: boolean;
    };
    commercial: {
      status: string;
      availabilityText: string | null;
      availableFrom: string | null;
      availableUntil: string | null;
      bookedFrom: string | null;
      bookedUntil: string | null;
      rateCard: string | null;
      rateCardValue: number | null;
      installationRemoval: string | null;
      installationRemovalValue: number | null;
    };
    internal: {
      internalNotes: string | null;
      monthlyCost: number | null;
      costCurrency: string | null;
      costType: string | null;
      costSupplier: string | null;
      costNotes: string | null;
      blockedReason: string | null;
      blockedFrom: string | null;
      blockedUntil: string | null;
      blockedNotes: string | null;
      latReal: number | null;
      lngReal: number | null;
      mapsUrl: string | null;
      gpsAuditStatus: string | null;
    } | null;
  };
  timeline: {
    generatedAt: string;
    empty: boolean;
    availability: {
      status: string;
      isBookable: boolean;
      reasons: string[];
      explanation: string;
      dateSemantics: "INCLUSIVE_WITH_SAME_DAY_HANDOFF";
      activeOverride: ActiveLocationOverride;
    };
    periods: LocationTimelinePeriod[];
  };
  permissions: {
    canViewInternalDetails: boolean;
    canViewFullReservationDetails: boolean;
  };
};

type LocationTimelinePeriod = {
  id: string;
  locationId: string;
  status: "HOLD" | "RESERVED" | "BOOKED";
  periodStart: string;
  periodEnd: string;
  isActiveToday: boolean;
  clientId: string | null;
  clientName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  campaignCode: string | null;
  sellerId: string | null;
  sellerName: string | null;
  contractCompany: string | null;
  contractNumber: string | null;
  holdExpiresAt: string | null;
  conflict: boolean;
  conflictReservationIds: string[];
};

export function LocationDetailDrawer({
  location,
  session,
  canEdit,
  onClose,
  onEdit,
  onDataChanged
}: {
  location: AdminLocationListItemDTO;
  session: AuthSession;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDataChanged?: () => void;
}) {
  const [data, setData] = useState<LocationTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const displayLocation = data?.location || location;
  const publicVisibility = data?.admin.publicVisibility || {
    showInPublic: location.showInPublic,
    showPricePublic: location.showPricePublic
  };
  const images = useMemo(() => data ? imageSet(data.location) : imageSetFromSummary(location), [data, location]);
  const publicHref = `/locatii/${displayLocation.id}`;
  const mapsUrl = mapsHref(data?.admin.internal?.mapsUrl || displayLocation.mapsUrl, displayLocation.latDisplay, displayLocation.lngDisplay);
  const adminCommercial = data?.admin.commercial;
  const productionSketchUrl = data?.location.productionSketchUrl || null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/locations/${encodeURIComponent(location.id)}/availability-timeline`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Detaliile locatiei nu au putut fi incarcate.");
        return payload as LocationTimelineResponse;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((detailError) => {
        if (!cancelled) setError(detailError instanceof Error ? detailError.message : "Detaliile locatiei nu au putut fi incarcate.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [location.id, refreshKey]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.code !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function copyPublicLink() {
    const absolute = typeof window === "undefined" ? publicHref : `${window.location.origin}${publicHref}`;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopyMessage("Linkul public a fost copiat.");
    } catch {
      setCopyMessage(absolute);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Detalii locatie ${displayLocation.code}`}>
      <button className="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Inchide detaliile locatiei" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-6xl flex-col overflow-hidden border-l border-focus-line bg-focus-navy shadow-2xl md:w-[min(92vw,1120px)]">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-focus-line bg-focus-ink/70 p-4">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Detalii locatie</p>
            <h2 className="font-display text-3xl font-black uppercase text-white">{displayLocation.code}</h2>
            <p className="mt-1 text-sm font-bold text-slate-300">{displayLocation.address || displayLocation.city || displayLocation.categoryName}</p>
          </div>
          <button className="focus-button secondary !min-h-0 px-3 py-2" type="button" onClick={onClose} aria-label="Inchide detaliile locatiei">
            <X size={18} />
          </button>
        </header>

        <div className="grid flex-1 gap-4 overflow-auto p-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,0.88fr)]">
          <section className="grid gap-4">
            <Panel title="Prezentare">
              <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="overflow-hidden rounded-lg border border-focus-line bg-focus-ink">
                  <img
                    src={images[0]}
                    alt={displayLocation.code}
                    className="h-[330px] w-full object-contain"
                    decoding="async"
                    onError={(event) => {
                      event.currentTarget.src = "/samples/location-placeholder.svg";
                    }}
                  />
                </div>
                <div className="grid content-start gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-focus-yellow">{displayLocation.categoryName}</p>
                    <h3 className="mt-1 font-display text-2xl font-black uppercase text-white">{displayLocation.address || displayLocation.code}</h3>
                    <p className="mt-2 flex items-center gap-2 text-sm font-bold text-slate-300">
                      <MapPin size={16} />
                      {displayLocation.city || "Romania"} {displayLocation.county ? `, ${displayLocation.county}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      status={displayLocation.status}
                      publicStatus={displayLocation.publicStatus}
                      availability={displayLocation.availabilityText}
                      label={displayLocation.availabilityLabel}
                    />
                    {displayLocation.availabilityDetail ? <span className="text-sm font-bold text-slate-300">{displayLocation.availabilityDetail}</span> : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <MiniSpec label="Dimensiune" value={displayLocation.size || "N/A"} />
                    <MiniSpec label="Suprafata" value={sqm(displayLocation.sqm)} />
                    <MiniSpec label="Tip media" value={displayLocation.type || "OOH"} />
                    <MiniSpec label="Vizibilitate public" value={publicVisibility.showInPublic ? "Publica" : "Ascunsa"} />
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {images.slice(0, 4).map((image, index) => (
                      <img
                        key={`${image}-${index}`}
                        src={image}
                        alt={`${displayLocation.code} poza ${index + 1}`}
                        className="h-20 rounded-md border border-focus-line object-cover"
                        loading="lazy"
                        decoding="async"
                        onError={(event) => {
                          event.currentTarget.src = "/samples/location-placeholder.svg";
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Date admin / comercial">
              <div className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
                <MiniSpec label="Portal public" value={publicVisibility.showInPublic ? "Vizibila" : "Ascunsa"} />
                <MiniSpec label="Pret public" value={publicVisibility.showPricePublic ? "Da" : "Nu"} />
                <MiniSpec label="Rate card admin" value={monthlyRate(adminCommercial?.rateCardValue ?? displayLocation.rateCardValue, adminCommercial?.rateCard ?? displayLocation.rateCard)} />
                <MiniSpec label="Montaj / neutralizare" value={oneTimeRate(adminCommercial?.installationRemovalValue ?? displayLocation.installationRemovalValue, adminCommercial?.installationRemoval ?? displayLocation.installationRemoval)} />
                <MiniSpec label="Status administrativ" value={adminCommercial?.status || displayLocation.status} />
              </div>
            </Panel>

            {data?.admin.internal ? (
              <Panel title="Date interne">
                <div className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
                  <MiniSpec label="Cost lunar" value={data.admin.internal.monthlyCost != null ? `${data.admin.internal.monthlyCost} ${data.admin.internal.costCurrency || ""}`.trim() : "-"} />
                  <MiniSpec label="Furnizor cost" value={data.admin.internal.costSupplier || "-"} />
                  <MiniSpec label="Tip cost" value={data.admin.internal.costType || "-"} />
                  <MiniSpec label="GPS audit" value={data.admin.internal.gpsAuditStatus || "-"} />
                  <MiniSpec label="Coordonate reale" value={data.admin.internal.latReal != null && data.admin.internal.lngReal != null ? `${data.admin.internal.latReal}, ${data.admin.internal.lngReal}` : "-"} />
                  <MiniSpec label="Blocare" value={data.admin.internal.blockedReason || "-"} />
                </div>
                {data.admin.internal.internalNotes || data.admin.internal.costNotes || data.admin.internal.blockedNotes ? (
                  <div className="mt-3 grid gap-2 text-sm text-slate-300">
                    {data.admin.internal.internalNotes ? <Note title="Observatii interne" text={data.admin.internal.internalNotes} /> : null}
                    {data.admin.internal.costNotes ? <Note title="Observatii cost" text={data.admin.internal.costNotes} /> : null}
                    {data.admin.internal.blockedNotes ? <Note title="Observatii blocare" text={data.admin.internal.blockedNotes} /> : null}
                  </div>
                ) : null}
              </Panel>
            ) : null}
          </section>

          <section className="grid content-start gap-4">
            <Panel title="Disponibilitate viitoare">
              {loading ? <p className="rounded-lg border border-focus-line bg-focus-ink/45 p-4 text-sm text-slate-300">Se incarca perioadele viitoare...</p> : null}
              {error ? <p className="rounded-lg border border-red-300/40 bg-red-500/10 p-4 text-sm font-bold text-red-100">{error}</p> : null}
              {!loading && !error && data?.timeline.empty ? (
                <div className="rounded-lg border border-emerald-300/35 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-100">
                  <CheckCircle2 className="mr-2 inline h-5 w-5" />
                  Nu exista rezervari viitoare pentru aceasta locatie.
                </div>
              ) : null}
              {!loading && data?.timeline.periods.length ? <TimelineList periods={data.timeline.periods} /> : null}
            </Panel>

            {canEdit && data?.admin.internal ? (
              <Panel title="Status inventar si blocaj comercial">
                <LocationAvailabilityControls
                  locationId={location.id}
                  lifecycleStatus={displayLocation.lifecycleStatus}
                  activeOverride={data.timeline.availability.activeOverride}
                  legacyBlock={{
                    reason: data.admin.internal.blockedReason,
                    from: data.admin.internal.blockedFrom,
                    until: data.admin.internal.blockedUntil,
                    notes: data.admin.internal.blockedNotes
                  }}
                  onChanged={() => {
                    setRefreshKey((current) => current + 1);
                    onDataChanged?.();
                  }}
                />
              </Panel>
            ) : null}

            <Panel title="Actiuni rapide">
              <div className="grid gap-2">
                <a className="focus-button" href={adminNewReservationHref({ locationId: displayLocation.id })}>
                  <Plus size={18} />
                  Creeaza rezervare pentru aceasta locatie
                </a>
                <a className="focus-button secondary" href={publicHref} target="_blank" rel="noreferrer">
                  <ExternalLink size={18} />
                  Deschide prezentarea publica
                </a>
                {productionSketchUrl ? (
                  <a className="focus-button secondary" href={productionSketchUrl} target="_blank" rel="noreferrer" download>
                    <Download size={18} />
                    Descarca schita de productie
                  </a>
                ) : null}
                <button className="focus-button secondary" type="button" onClick={copyPublicLink}>
                  <Copy size={18} />
                  Copiaza link prezentare
                </button>
                <a className="focus-button secondary" href={mapsUrl} target="_blank" rel="noreferrer">
                  <MapPin size={18} />
                  Deschide in Maps
                </a>
                {canEdit ? (
                  <button className="focus-button secondary" type="button" onClick={onEdit}>
                    <Edit size={18} />
                    Editeaza locatia
                  </button>
                ) : null}
                {copyMessage ? <p className="rounded-md border border-focus-line bg-focus-ink/45 p-2 text-xs font-bold text-slate-200">{copyMessage}</p> : null}
              </div>
            </Panel>

            <Panel title="Context acces">
              <p className="text-sm text-slate-300">
                Rol curent: <strong className="text-white">{session.role}</strong>. Detaliile despre client, campanie, seller si contract apar doar cand rolul sau ownership-ul permite.
              </p>
            </Panel>
          </section>
        </div>
      </aside>
    </div>
  );
}

function TimelineList({ periods }: { periods: LocationTimelinePeriod[] }) {
  return (
    <div className="grid gap-3">
      {periods.map((period) => (
        <article key={period.id} className={`rounded-lg border p-3 ${periodTone(period.status, period.conflict)}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge status={period.status} />
                {period.isActiveToday ? <span className="rounded-full bg-white/12 px-2 py-1 text-xs font-black uppercase text-white">Activ azi</span> : null}
                {period.conflict ? <span className="rounded-full bg-red-500/20 px-2 py-1 text-xs font-black uppercase text-red-100"><AlertTriangle className="mr-1 inline h-3 w-3" /> Suprapunere</span> : null}
              </div>
              <p className="mt-2 flex items-center gap-2 font-black text-white">
                <CalendarDays size={16} />
                {date(period.periodStart)} - {date(period.periodEnd)}
              </p>
              {period.clientName || period.campaignName ? (
                <p className="mt-1 text-sm text-slate-200">
                  {[period.clientName, period.campaignName, period.campaignCode].filter(Boolean).join(" / ")}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-400">Context client/campanie ascuns pentru rolul curent.</p>
              )}
              {period.sellerName || period.contractNumber ? (
                <p className="mt-1 text-xs text-slate-400">
                  {[period.sellerName ? `Seller: ${period.sellerName}` : null, period.contractCompany, period.contractNumber].filter(Boolean).join(" / ")}
                </p>
              ) : null}
            </div>
            <a className="focus-button secondary !min-h-0 px-3 py-2 text-xs" href={adminReservationHref(period.id)}>
              Vezi rezervarea
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-focus-line bg-focus-ink/70 p-4">
      <h3 className="mb-3 text-sm font-black uppercase text-focus-yellow">{title}</h3>
      {children}
    </section>
  );
}

function MiniSpec({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-focus-line bg-focus-navy/45 p-3">
      <span className="block text-[10px] font-black uppercase text-focus-yellow">{label}</span>
      <span className="mt-1 block font-bold text-white">{value}</span>
    </span>
  );
}

function Note({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md border border-focus-line bg-focus-navy/45 p-3">
      <p className="text-xs font-black uppercase text-focus-yellow">{title}</p>
      <p className="mt-1 whitespace-pre-wrap text-slate-200">{text}</p>
    </div>
  );
}

function Badge({ status }: { status: LocationTimelinePeriod["status"] }) {
  const className = {
    HOLD: "border-focus-yellow/60 bg-focus-yellow/10 text-focus-yellow",
    RESERVED: "border-amber-300/60 bg-amber-300/10 text-amber-100",
    BOOKED: "border-red-300/60 bg-red-400/10 text-red-100"
  }[status];
  const label = {
    HOLD: "HOLD",
    RESERVED: "HOLD",
    BOOKED: "Rezervat"
  }[status];
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-black uppercase ${className}`}>{label}</span>;
}

function periodTone(status: LocationTimelinePeriod["status"], conflict: boolean) {
  if (conflict) return "border-red-300/50 bg-red-500/10";
  if (status === "BOOKED") return "border-red-300/35 bg-red-400/10";
  return "border-focus-yellow/35 bg-focus-yellow/10";
}

function imageSet(location: LocationDTO) {
  const images = [location.mainPhotoUrl, ...location.images.map((image) => image.url)].filter(Boolean) as string[];
  const unique = [...new Set(images)].slice(0, 4);
  return unique.length ? unique : ["/samples/location-placeholder.svg"];
}

function imageSetFromSummary(location: AdminLocationListItemDTO) {
  return location.mainPhotoUrl ? [location.mainPhotoUrl] : ["/samples/location-placeholder.svg"];
}

function date(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
