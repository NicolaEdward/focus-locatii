import { AlertTriangle, CircleCheck, LoaderCircle, RefreshCw, ShieldCheck, TimerReset, Warehouse } from "lucide-react";
import type { InventoryAvailabilitySummaryDTO, OccupancySummaryDTO } from "@/types/location";

type Props = {
  summary?: OccupancySummaryDTO | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
};

export function OccupancySummary({ summary, loading = false, error = null, onRefresh }: Props) {
  const candidate = summary?.inventory;
  const inventory = verifiedInventory(candidate) ? candidate : null;
  const cards = [
    { label: "Locații OOH active", value: inventory?.staticLocations, icon: Warehouse, tone: "text-slate-100" },
    { label: "Libere azi", value: inventory?.freeToday, icon: CircleCheck, tone: "text-emerald-200" },
    { label: "Ocupate azi", value: inventory?.occupiedToday, icon: ShieldCheck, tone: "text-red-200" },
    { label: "HOLD azi", value: inventory?.heldToday, icon: TimerReset, tone: "text-amber-200" },
    { label: "Blocate / de verificat", value: inventory ? inventory.blockedToday + inventory.unknownToday : undefined, icon: AlertTriangle, tone: "text-amber-200" }
  ];

  return (
    <section className="grid min-w-0 gap-3" aria-label="Disponibilitatea locațiilor OOH" aria-busy={loading}>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(({ label, value, icon: Icon, tone }) => (
          <article key={label} aria-label={`${label}: ${value ?? "neverificat"}`} className="min-w-0 rounded-lg border border-focus-line bg-focus-ink/65 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p data-ui-contrast className="min-w-0 break-words text-xs font-black uppercase text-slate-400">{label}</p>
              <Icon className={`shrink-0 ${tone}`} size={18} aria-hidden="true" />
            </div>
            <p data-ui-contrast className={`mt-2 text-3xl font-black tabular-nums ${tone}`}>{value ?? "—"}</p>
          </article>
        ))}
      </div>

      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 text-xs text-slate-400">
        <div className="grid min-w-0 gap-1">
          {inventory ? (
            <>
              <p>Inventar global, indiferent de filtrele listei. Situație la {formatDateKey(inventory.dateKey)}, ora {snapshotTime(inventory.asOf)} (București).</p>
              <p>Inventar activ total: <strong>{inventory.activeLocations}</strong>.{inventory.digitalLocations > 0 ? <> Locații digitale excluse din OOH: <strong>{inventory.digitalLocations}</strong>.</> : null} Mentenanță: <strong>{inventory.maintenanceLocations}</strong>, în afara totalului activ.</p>
              <p>Blocaje: <strong>{inventory.blockedToday}</strong> · De verificat: <strong>{inventory.unknownToday}</strong>. Rezervări viitoare în listă: <strong>{countOrDash(summary?.upcoming)}</strong>.</p>
              <p>Rezervări/HOLD-uri curente și viitoare accesibile: <strong>{countOrDash(summary?.activeOrUpcoming)}</strong> înregistrări. Acestea nu reprezintă locații ocupate azi; pentru o ofertă verifică intervalul solicitat.</p>
            </>
          ) : null}
          {loading ? (
            <p role="status" className="inline-flex items-center gap-2 font-bold text-slate-200"><LoaderCircle className="animate-spin" size={15} aria-hidden="true" /> {inventory ? "Se actualizează disponibilitatea; valorile afișate sunt din ultima verificare." : "Se verifică disponibilitatea locațiilor."}</p>
          ) : error ? (
            <p role="status" className="font-bold text-amber-200">Actualizarea disponibilității a eșuat. {inventory ? "Sunt afișate ultimele date verificate, la ora indicată mai sus." : "Numărul locațiilor libere nu este verificat."} Reîncarcă datele înainte de confirmarea unei oferte.</p>
          ) : !inventory ? (
            <p role="status" className="font-bold text-amber-200">Disponibilitatea locațiilor nu este verificată. Reîncarcă datele; lipsa informațiilor nu înseamnă zero locații libere.</p>
          ) : null}
        </div>
        {onRefresh ? <button className="focus-button secondary shrink-0 !min-h-0 px-3 py-2 text-xs" type="button" onClick={onRefresh} disabled={loading}><RefreshCw size={15} aria-hidden="true" /> Actualizează disponibilitatea</button> : null}
      </div>
    </section>
  );
}

function countOrDash(value: number | undefined) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? value : "—";
}

function verifiedInventory(value: InventoryAvailabilitySummaryDTO | null | undefined): value is InventoryAvailabilitySummaryDTO {
  if (!value || value.timeZone !== "Europe/Bucharest" || !/^\d{4}-\d{2}-\d{2}$/.test(value.dateKey) || !Number.isFinite(Date.parse(value.asOf))) return false;
  const parsedDay = new Date(`${value.dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDay.getTime()) || parsedDay.toISOString().slice(0, 10) !== value.dateKey) return false;
  for (const field of ["activeLocations", "staticLocations", "digitalLocations", "maintenanceLocations", "freeToday", "occupiedToday", "heldToday", "blockedToday", "unknownToday"] as const) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) return false;
  }
  return value.staticLocations + value.digitalLocations === value.activeLocations && value.freeToday + value.occupiedToday + value.heldToday + value.blockedToday + value.unknownToday === value.staticLocations;
}

function formatDateKey(key: string) {
  return key.split("-").reverse().join(".");
}

function snapshotTime(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
