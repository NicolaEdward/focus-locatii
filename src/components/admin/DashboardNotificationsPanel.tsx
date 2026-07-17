import Link from "next/link";
import { AlertTriangle, ArrowRight, BellRing, CalendarClock } from "lucide-react";
import type { DashboardData } from "@/lib/dashboard";

export function DashboardNotificationsPanel({
  rows,
  title = "Atenție azi"
}: {
  rows: DashboardData["notifications"];
  title?: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-focus-line bg-focus-ink/70">
      <div className="flex items-center justify-between gap-3 border-b border-focus-line px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-black uppercase text-focus-yellow"><BellRing size={17} /> {title}</h2>
          <p className="mt-1 text-xs text-slate-400">Scadențe, follow-up-uri și acțiuni care necesită intervenție.</p>
        </div>
        <span className="rounded-full bg-focus-yellow px-2.5 py-1 text-xs font-black text-focus-navy">{rows.length}</span>
      </div>
      {rows.length ? (
        <div className="divide-y divide-focus-line">
          {rows.map((row) => {
            const href = notificationHref(row);
            return (
              <article className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]" key={row.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.severity === "high" ? <AlertTriangle className="text-red-200" size={16} /> : <CalendarClock className="text-focus-yellow" size={16} />}
                    <strong className="text-sm text-white">{row.title}</strong>
                    {row.user?.name ? <span className="text-xs text-slate-500">Responsabil: {row.user.name}</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-300">{row.message}</p>
                  <p className="mt-1 text-xs text-slate-400">{row.recommendedAction || "Verifică situația și actualizează următorul pas."}</p>
                </div>
                <div className="flex items-center gap-3 md:justify-end">
                  {row.dueDate ? <time className="text-xs font-bold text-slate-300">{formatDate(row.dueDate)}</time> : null}
                  {href ? <Link className="inline-flex items-center gap-1 text-xs font-black text-focus-yellow hover:text-white" href={href} prefetch={false}>Deschide <ArrowRight size={14} /></Link> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="px-5 py-6 text-sm text-slate-400">Nu există acțiuni urgente pentru acest cont.</p>
      )}
    </section>
  );
}

function notificationHref(row: DashboardData["notifications"][number]) {
  if (row.entityType === "crm_opportunity" && row.entityId) return `/admin/crm?view=today&kind=opportunity&record=${encodeURIComponent(row.entityId)}`;
  if (row.entityType === "crm_prospect" && row.entityId) return `/admin/crm?view=today&kind=prospect&record=${encodeURIComponent(row.entityId)}`;
  if (row.type.startsWith("receivable_")) {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : null;
    return metadata && typeof metadata.clientId === "string"
      ? `/admin/clienti?clientId=${encodeURIComponent(metadata.clientId)}`
      : null;
  }
  if (row.entityType === "reservation") return "/admin/operational";
  return null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
