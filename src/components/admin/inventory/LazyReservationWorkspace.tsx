"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { EscapeCloseHandler } from "@/hooks/use-escape-close";
import type { AuthSession } from "@/lib/auth";
import type { AdminLocationListItemDTO, OccupancySummaryDTO, OfferRequestDTO, ReservationDTO } from "@/types/location";

const loadAdminReservationsPanel = () => import("@/components/admin/AdminReservationsPanel").then((module) => module.AdminReservationsPanel);
const AdminReservationsPanel = dynamic(
  loadAdminReservationsPanel,
  { ssr: false, loading: () => <WorkspaceLoading /> }
);

export type ReservationWorkspaceRequest = {
  key: number;
  reservationId?: string;
  locationId?: string;
  newReservation?: boolean;
  action?: "edit" | "cancel";
};

type WorkspacePayload = {
  locations: AdminLocationListItemDTO[];
  reservations: ReservationDTO[];
  occupancySummary: OccupancySummaryDTO;
  offerRequests: OfferRequestDTO[];
};

export function LazyReservationWorkspace({
  request,
  session,
  onClose,
  onChanged
}: {
  request: ReservationWorkspaceRequest | null;
  session: AuthSession;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPayload(null);
    syncWorkspaceUrl(request);
    void loadAdminReservationsPanel();

    loadWorkspacePayload(request, controller.signal)
      .then((workspacePayload) => {
        if (cancelled) return;
        setPayload(workspacePayload);
      })
      .catch((requestError) => {
        if (!cancelled && !controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "Gestionarea rezervarilor nu a putut fi incarcata.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [request]);

  if (!request) return null;

  function close() {
    clearWorkspaceUrl();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Gestionare rezervari">
      <EscapeCloseHandler onClose={close} />
      <div className="flex h-full min-w-0 flex-col bg-focus-navy">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-focus-line bg-focus-ink px-4 py-3">
          <div><p className="text-xs font-black uppercase text-focus-yellow">Modul incarcat la cerere</p><h2 className="font-display text-2xl font-black uppercase text-white">Gestionare completa rezervari</h2></div>
          <button className="focus-button secondary" type="button" onClick={close}><X size={18} /> Inchide</button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-3 md:p-5">
          {loading ? <WorkspaceLoading /> : null}
          {error ? <p className="mx-auto mt-8 max-w-2xl rounded-lg border border-red-400/40 bg-red-500/10 p-5 text-sm font-bold text-red-100">{error}</p> : null}
          {payload ? (
            <AdminReservationsPanel
              key={request.key}
              locations={payload.locations}
              initialReservations={payload.reservations}
              initialOccupancySummary={payload.occupancySummary}
              initialOfferRequests={payload.offerRequests}
              focusedReservationId={request.reservationId}
              focusedAction={request.action}
              onQuickActionComplete={request.action ? close : undefined}
              onLocationsUpdated={(locations) => {
                setPayload((current) => current ? { ...current, locations } : current);
                onChanged();
              }}
              session={session}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WorkspaceLoading() {
  return <div className="mx-auto mt-8 flex max-w-xl items-center justify-center gap-3 rounded-lg border border-focus-line bg-focus-ink/60 p-6 text-sm font-bold text-slate-200"><LoaderCircle className="animate-spin text-focus-yellow" size={20} /> Se incarca instrumentele complete numai pentru aceasta actiune...</div>;
}

async function loadWorkspacePayload(request: ReservationWorkspaceRequest, signal: AbortSignal): Promise<WorkspacePayload> {
  if (request.action && request.reservationId) {
    const reservationPayload = await fetch(`/api/reservations/${encodeURIComponent(request.reservationId)}`, {
      cache: "no-store",
      signal
    }).then(readPayload);
    const reservation = reservationPayload.reservation as ReservationDTO;
    const locationId = request.locationId || reservation.locationId;
    const locationQuery = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
    const [locationsPayload, summaryPayload] = await Promise.all([
      fetch(`/api/admin/reservation-locations${locationQuery}`, { cache: "no-store", signal }).then(readPayload),
      fetch("/api/reservations?view=occupancy-summary", { cache: "no-store", signal }).then(readPayload)
    ]);
    return {
      locations: locationsPayload.locations || [],
      reservations: [reservation],
      occupancySummary: summaryPayload.summary || emptyOccupancySummary(),
      offerRequests: []
    };
  }

  const [locationsPayload, reservationsPayload, requestsPayload] = await Promise.all([
    fetch("/api/admin/reservation-locations", { cache: "no-store", signal }).then(readPayload),
    fetch("/api/reservations?view=workspace", { cache: "no-store", signal }).then(readPayload),
    fetch("/api/offer-requests", { cache: "no-store", signal }).then(async (response) => response.ok ? response.json() : { requests: [] })
  ]);
  return {
    locations: locationsPayload.locations || [],
    reservations: reservationsPayload.reservations || [],
    occupancySummary: reservationsPayload.summary || emptyOccupancySummary(),
    offerRequests: requestsPayload.requests || []
  };
}

function emptyOccupancySummary(): OccupancySummaryDTO {
  return { activeHolds: 0, occupiedNow: 0, upcoming: 0, activeOrUpcoming: 0 };
}

async function readPayload(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || "Datele nu au putut fi incarcate.");
  return payload;
}

function syncWorkspaceUrl(request: ReservationWorkspaceRequest) {
  const params = new URLSearchParams(window.location.search);
  if (request.reservationId) params.set("reservationId", request.reservationId); else params.delete("reservationId");
  if (request.newReservation) params.set("newReservation", "1"); else params.delete("newReservation");
  if (request.action) params.set("reservationAction", request.action); else params.delete("reservationAction");
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
}

function clearWorkspaceUrl() {
  const params = new URLSearchParams(window.location.search);
  params.delete("reservationId");
  params.delete("newReservation");
  params.delete("reservationAction");
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
}
