import { CalendarClock, Clock3, ShieldCheck, TimerReset } from "lucide-react";
import type { OccupancySummaryDTO } from "@/types/location";

export function OccupancySummary({ summary }: { summary: OccupancySummaryDTO }) {
  const cards = [
    { label: "Ocupate acum", value: summary.occupiedNow, icon: ShieldCheck, tone: "text-red-200" },
    { label: "HOLD activ", value: summary.activeHolds, icon: TimerReset, tone: "text-amber-200" },
    { label: "Urmeaza", value: summary.upcoming, icon: CalendarClock, tone: "text-sky-200" },
    { label: "Active / viitoare", value: summary.activeOrUpcoming, icon: Clock3, tone: "text-emerald-200" }
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Rezumat ocupare">
      {cards.map(({ label, value, icon: Icon, tone }) => (
        <article key={label} className="rounded-lg border border-focus-line bg-focus-ink/65 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-black uppercase text-slate-400">{label}</p>
            <Icon className={tone} size={18} aria-hidden="true" />
          </div>
          <p className={`mt-2 text-3xl font-black ${tone}`}>{value}</p>
        </article>
      ))}
    </div>
  );
}
