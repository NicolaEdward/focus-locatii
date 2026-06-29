"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Copy, Download, Edit, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import type { CategoryDTO, LocationDTO, OfferRequestDTO, ReservationDTO } from "@/types/location";
import { LocationEditor } from "@/components/admin/LocationEditor";
import { AdminReservationsPanel } from "@/components/admin/AdminReservationsPanel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { AuthSession } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

export function AdminDashboard({
  initialLocations,
  categories,
  initialReservations,
  operationReservations,
  initialOfferRequests,
  session
}: {
  initialLocations: LocationDTO[];
  categories: CategoryDTO[];
  initialReservations: ReservationDTO[];
  operationReservations?: ReservationDTO[];
  initialOfferRequests: OfferRequestDTO[];
  session: AuthSession;
}) {
  const searchParams = useSearchParams();
  const focusedLocationParam = searchParams.get("locationId");
  const [locations, setLocations] = useState(initialLocations);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<LocationDTO | null | undefined>(undefined);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const canManageLocations = hasPermission(session.role, "inventory.manage");
  const focusedLocation = useMemo(
    () => locations.find((location) => location.id === focusedLocationParam || location.code === focusedLocationParam) || null,
    [focusedLocationParam, locations]
  );

  useEffect(() => {
    if (!focusedLocationParam) return;
    if (focusedLocation) {
      setSearch(focusedLocation.code || focusedLocation.address || focusedLocationParam);
      setFeedback({ tone: "ok", text: `Locatia ${focusedLocation.code} este filtrata mai jos.` });
      return;
    }
    setSearch(focusedLocationParam);
    setFeedback({ tone: "error", text: "Locatia cautata nu este vizibila in lista curenta." });
  }, [focusedLocation, focusedLocationParam]);

  const filtered = useMemo(() => {
    return locations.filter((location) => {
      const haystack = [
        location.code,
        location.address,
        location.city,
        location.county,
        location.type,
        location.categoryName,
        location.internalNotes
      ]
        .join(" ")
        .toLowerCase();
      if (search && !haystack.includes(search.toLowerCase())) return false;
      if (status && location.status !== status) return false;
      if (category && location.categorySlug !== category) return false;
      return true;
    });
  }, [category, locations, search, status]);

  async function duplicate(location: LocationDTO) {
    const label = locationLabel(location);
    if (!confirm(`Duplici locatia ${label}? Se va crea o copie ascunsa din portalul public pana la verificare.`)) return;
    const response = await fetch(`/api/locations/${location.id}?action=duplicate`, { method: "POST" });
    if (response.ok) window.location.reload();
    else setFeedback({ tone: "error", text: "Locatia nu a putut fi duplicata." });
  }

  async function remove(location: LocationDTO) {
    const label = locationLabel(location);
    if (!confirm(`Stergi locatia ${label}? Actiunea este permanenta si nu se poate aplica daca exista istoric comercial.`)) return;
    const response = await fetch(`/api/locations/${location.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => null);
    if (response.ok) {
      setLocations((current) => current.filter((item) => item.id !== location.id));
      setFeedback({ tone: "ok", text: "Locatia a fost stearsa." });
    } else {
      setFeedback({ tone: "error", text: data?.error || "Locatia nu a putut fi stearsa." });
    }
  }

  return (
    <main className="focus-shell py-8">
      <section className="focus-container grid gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Panou administrare</p>
            <h1 className="font-display text-4xl font-black uppercase">Locatii Focus Media</h1>
          </div>
          {canManageLocations ? <div className="flex flex-wrap gap-2">
            <button className="focus-button" type="button" onClick={() => setEditing(null)}>
              <Plus size={18} />
              Adauga locatie
            </button>
            <a className="focus-button secondary" href="/api/export/json">
              <Download size={18} />
              Export inventar JSON
            </a>
          </div> : null}
        </div>

        <AdminReservationsPanel
          locations={locations}
          initialReservations={initialReservations}
          operationReservations={operationReservations}
          initialOfferRequests={initialOfferRequests}
          onLocationsUpdated={setLocations}
          session={session}
        />

        {feedback ? <p className={`rounded-lg border px-4 py-3 text-sm font-bold ${feedback.tone === "ok" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100" : "border-red-400/40 bg-red-400/10 text-red-100"}`}>{feedback.text}</p> : null}

        <div className="focus-card grid gap-3 rounded-lg p-4 md:grid-cols-[1fr_220px_220px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" />
            <input
              className="focus-input pl-10"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cauta cod, adresa, oras, tip"
            />
          </label>
          <select className="focus-input" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">Toate categoriile</option>
            {categories.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
          <select className="focus-input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Toate statusurile</option>
            <option value="AVAILABLE">AVAILABLE</option>
            <option value="AVAILABLE_FROM">AVAILABLE_FROM</option>
            <option value="BOOKED">BOOKED</option>
            <option value="RESERVED">RESERVED</option>
            <option value="UNKNOWN">UNKNOWN</option>
          </select>
        </div>

        <div id="locatii" className="scroll-mt-28 overflow-x-auto rounded-lg border border-focus-line">
          <table className="w-full min-w-[980px] border-collapse bg-focus-ink/70 text-sm">
            <thead className="bg-focus-navy text-left text-xs uppercase text-focus-yellow">
              <tr>
                <Th>Cod</Th>
                <Th>Locatie</Th>
                <Th>Vizibilitate</Th>
                <Th>Status calculat</Th>
                <Th>Pret</Th>
                <Th>Actiuni</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((location) => (
                <tr
                  key={location.id}
                  className={`border-t border-focus-line ${focusedLocationParam && (location.id === focusedLocationParam || location.code === focusedLocationParam) ? "bg-focus-yellow/10 outline outline-1 outline-focus-yellow/50" : ""}`}
                >
                  <Td>
                    <strong className="text-white">{location.code}</strong>
                    <p className="text-xs text-slate-400">{location.categoryName}</p>
                  </Td>
                  <Td>
                    <p className="font-bold">{location.address || "No address"}</p>
                    <p className="text-xs text-slate-400">
                      {location.city || "N/A"} | {location.type || "N/A"} | {location.sqm || 0} sqm
                    </p>
                  </Td>
                  <Td>
                    <div className="grid gap-1">
                      <span className={`text-xs font-black uppercase ${location.showInPublic ? "text-emerald-200" : "text-slate-500"}`}>
                        {location.showInPublic ? "Public" : "Ascunsa public"}
                      </span>
                      <span className="text-xs text-slate-400">
                        Pret {location.showPricePublic ? "public" : "ascuns"} / montaj {location.showInstallationCostPublic ? "public" : "ascuns"}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <StatusBadge status={location.status} publicStatus={location.publicStatus} availability={location.availabilityLabel} />
                    <p className="mt-1 max-w-xs text-xs text-slate-400">{location.availabilityDetail || location.availabilityText || "Disponibilitatea este calculata din rezervari."}</p>
                  </Td>
                  <Td>
                    <span className="font-bold text-white">{location.rateCard || (location.rateCardValue != null ? `${location.rateCardValue} EUR` : "-")}</span>
                    {location.installationRemoval ? <small className="block text-slate-400">Montaj: {location.installationRemoval}</small> : null}
                  </Td>
                  <Td>
                    {canManageLocations ? <div className="flex flex-wrap gap-2">
                      <button className="focus-button secondary" type="button" onClick={() => setEditing(location)} title="Edit">
                        <Edit size={16} />
                        Editare
                      </button>
                      <LocationActionMenu
                        location={location}
                        onEdit={() => setEditing(location)}
                        onDuplicate={() => duplicate(location)}
                        onDelete={() => remove(location)}
                      />
                    </div> : <span className="text-xs text-slate-500">Doar vizualizare</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canManageLocations && editing !== undefined ? (
        <LocationEditor
          location={editing}
          categories={categories}
          onClose={() => setEditing(undefined)}
          onSaved={(saved) => {
            setLocations((current) => {
              const exists = current.some((location) => location.id === saved.id);
              return exists ? current.map((location) => (location.id === saved.id ? saved : location)) : [saved, ...current];
            });
            setEditing(undefined);
          }}
        />
      ) : null}
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-black">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="align-top px-4 py-3">{children}</td>;
}

function LocationActionMenu({
  location,
  onEdit,
  onDuplicate,
  onDelete
}: {
  location: LocationDTO;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <details className="relative">
      <summary className="focus-button secondary cursor-pointer list-none" title={`Actiuni pentru ${location.code}`}>
        <MoreHorizontal size={16} />
        Actiuni
      </summary>
      <div className="absolute right-0 z-20 mt-2 grid min-w-56 gap-1 rounded-lg border border-focus-line bg-focus-navy p-2 shadow-2xl">
        <button className="rounded-md px-3 py-2 text-left text-sm font-bold text-slate-100 hover:bg-focus-yellow/10" type="button" onClick={onEdit}>
          <Edit className="mr-2 inline h-4 w-4" /> Editare completa
        </button>
        <button className="rounded-md px-3 py-2 text-left text-sm font-bold text-slate-100 hover:bg-focus-yellow/10" type="button" onClick={onDuplicate}>
          <Copy className="mr-2 inline h-4 w-4" /> Duplica locatia
        </button>
        <button className="rounded-md px-3 py-2 text-left text-sm font-bold text-red-100 hover:bg-red-500/10" type="button" onClick={onDelete}>
          <Trash2 className="mr-2 inline h-4 w-4" /> Sterge / arhiveaza
        </button>
      </div>
    </details>
  );
}

function locationLabel(location: LocationDTO) {
  return [location.code, location.address || location.city].filter(Boolean).join(" - ") || location.id;
}
