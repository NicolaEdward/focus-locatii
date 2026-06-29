"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Copy, Download, Edit, Eye, EyeOff, Plus, Search, Trash2 } from "lucide-react";
import type { CategoryDTO, LocationDTO, LocationStatus, OfferRequestDTO, ReservationDTO } from "@/types/location";
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

  async function quickPatch(id: string, patch: Partial<LocationDTO> & { categoryName?: string }) {
    setFeedback(null);
    const response = await fetch(`/api/locations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const data = await response.json();
    if (response.ok) {
      setLocations((current) => current.map((location) => (location.id === id ? data.location : location)));
      setFeedback({ tone: "ok", text: "Modificarile au fost salvate." });
    } else {
      setFeedback({ tone: "error", text: data?.error || "Modificarile nu au putut fi salvate." });
    }
  }

  async function duplicate(id: string) {
    const response = await fetch(`/api/locations/${id}?action=duplicate`, { method: "POST" });
    if (response.ok) window.location.reload();
    else setFeedback({ tone: "error", text: "Locatia nu a putut fi duplicata." });
  }

  async function remove(id: string) {
    if (!confirm("Stergi locatia?")) return;
    const response = await fetch(`/api/locations/${id}`, { method: "DELETE" });
    const data = await response.json().catch(() => null);
    if (response.ok) {
      setLocations((current) => current.filter((location) => location.id !== id));
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

        <div id="locatii" className="scroll-mt-28 overflow-hidden rounded-lg border border-focus-line">
          <table className="w-full min-w-[1100px] border-collapse bg-focus-ink/70 text-sm">
            <thead className="bg-focus-navy text-left text-xs uppercase text-focus-yellow">
              <tr>
                <Th>Cod</Th>
                <Th>Locatie</Th>
                <Th>Status</Th>
                <Th>Disponibilitate</Th>
                <Th>Pret</Th>
                <Th>Public</Th>
                <Th>GPS</Th>
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
                    {canManageLocations ? <select
                      className="focus-input"
                      value={location.status}
                      onChange={(event) => quickPatch(location.id, { status: event.target.value as LocationStatus })}
                    >
                      <option value="AVAILABLE">AVAILABLE</option>
                      <option value="AVAILABLE_FROM">AVAILABLE_FROM</option>
                      <option value="BOOKED">BOOKED</option>
                      <option value="RESERVED">RESERVED</option>
                      <option value="UNKNOWN">UNKNOWN</option>
                    </select> : <StatusBadge status={location.status} availability={location.availabilityLabel} />}
                  </Td>
                  <Td>
                    {canManageLocations ? <input
                      className="focus-input"
                      defaultValue={location.availabilityText || ""}
                      onBlur={(event) => event.target.value !== (location.availabilityText || "") && quickPatch(location.id, { availabilityText: event.target.value })}
                    /> : <span>{location.availabilityText || location.availabilityLabel}</span>}
                  </Td>
                  <Td>
                    {canManageLocations ? <input
                      className="focus-input"
                      defaultValue={location.rateCard || ""}
                      onBlur={(event) => event.target.value !== (location.rateCard || "") && quickPatch(location.id, { rateCard: event.target.value })}
                    /> : <span>{location.rateCard || "-"}</span>}
                  </Td>
                  <Td>
                    {canManageLocations ? <div className="grid gap-2">
                      <ToggleMini
                        label="Visible"
                        active={location.showInPublic}
                        onClick={() => quickPatch(location.id, { showInPublic: !location.showInPublic })}
                      />
                      <ToggleMini
                        label="Price"
                        active={location.showPricePublic}
                        onClick={() => quickPatch(location.id, { showPricePublic: !location.showPricePublic })}
                      />
                    </div> : <span className="text-xs text-slate-400">{location.showInPublic ? "Vizibila" : "Ascunsa"}</span>}
                  </Td>
                  <Td>
                    <StatusBadge status={location.gpsAuditStatus === "OK" ? "AVAILABLE" : "UNKNOWN"} availability={location.gpsAuditStatus} />
                    <p className="mt-1 text-xs text-slate-400">
                      {location.latReal?.toFixed(5) || "N/A"}, {location.lngReal?.toFixed(5) || "N/A"}
                    </p>
                  </Td>
                  <Td>
                    {canManageLocations ? <div className="flex flex-wrap gap-2">
                      <button className="focus-button secondary" type="button" onClick={() => setEditing(location)} title="Edit">
                        <Edit size={16} />
                      </button>
                      <button className="focus-button secondary" type="button" onClick={() => duplicate(location.id)} title="Duplicate">
                        <Copy size={16} />
                      </button>
                      <button className="focus-button secondary" type="button" onClick={() => remove(location.id)} title="Delete">
                        <Trash2 size={16} />
                      </button>
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

function ToggleMini({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className="inline-flex items-center gap-2 text-xs font-bold text-slate-200"
      type="button"
      onClick={onClick}
    >
      {active ? <Eye className="h-4 w-4 text-emerald-300" /> : <EyeOff className="h-4 w-4 text-slate-500" />}
      {label}
    </button>
  );
}
