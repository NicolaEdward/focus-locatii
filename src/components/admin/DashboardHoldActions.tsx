"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import type { AuthSession } from "@/lib/auth";
import type { DashboardData } from "@/lib/dashboard";

type HoldRow = DashboardData["coo"]["holds"][number];
type HoldAction = "confirmBooking" | "extendHold" | "releaseHold" | "markLost" | "changePeriod";

export function DashboardHoldActions({
  session,
  activeHolds,
  expiredHolds
}: {
  session: AuthSession;
  activeHolds: HoldRow[];
  expiredHolds: HoldRow[];
}) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () => [
      ...expiredHolds.filter((row) => !hiddenIds.has(row.id)).map((row) => ({ row, expired: true })),
      ...activeHolds.filter((row) => !hiddenIds.has(row.id)).map((row) => ({ row, expired: false }))
    ].slice(0, 12),
    [activeHolds, expiredHolds, hiddenIds]
  );

  const title = session.role === "SALES_AGENT" ? "Holdurile mele" : "Holduri in lucru";
  const canConfirmBooking = session.role !== "SALES_AGENT";

  async function command(row: HoldRow, action: HoldAction, body: Record<string, unknown> = {}, success = "Actiunea a fost executata.") {
    setBusy(`${action}-${row.id}`);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/command-center", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reservationId: row.id, action, ...body })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Actiunea nu a putut fi executata.");
      setMessage(success);
      if (["releaseHold", "markLost", "confirmBooking"].includes(action) || (action === "extendHold" && row.status === "EXPIRED")) {
        setHiddenIds((current) => new Set(current).add(row.id));
      }
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "Actiunea nu a putut fi executata.");
    } finally {
      setBusy(null);
    }
  }

  function changePeriod(row: HoldRow) {
    const periodStart = window.prompt("Data noua de start campanie (YYYY-MM-DD)", row.periodStart.slice(0, 10));
    if (!periodStart) return;
    const periodEnd = window.prompt("Data noua de final campanie (YYYY-MM-DD)", row.periodEnd.slice(0, 10));
    if (!periodEnd) return;
    command(row, "changePeriod", { periodStart, periodEnd }, "Perioada holdului a fost schimbata.");
  }

  return (
    <section className="overflow-hidden rounded-lg border border-focus-line bg-focus-ink/70">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-focus-line px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-black uppercase text-focus-yellow">
            <CalendarClock size={18} /> {title}
          </h2>
          <p className="mt-1 text-xs font-bold text-slate-400">
            {session.role === "SALES_AGENT"
              ? "Actiuni rapide pentru holdurile din portofoliul tau."
              : "Actiuni rapide pentru holdurile care asteapta decizie comerciala."}
          </p>
        </div>
        <Link className="inline-flex items-center gap-1 text-xs font-bold text-slate-300 hover:text-white" href="/admin/locatii#rezervari">
          Vezi lista completa <ArrowRight size={14} />
        </Link>
      </div>

      <div className="grid gap-3 p-5">
        {message ? <Feedback tone="green">{message}</Feedback> : null}
        {error ? <Feedback tone="red">{error}</Feedback> : null}

        {rows.length ? rows.map(({ row, expired }) => (
          <article className="rounded-lg border border-focus-line bg-focus-navy/40 p-4" key={row.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-focus-yellow">{row.code} {row.city ? `- ${row.city}` : ""}</p>
                <h3 className="font-black text-white">{row.clientName}</h3>
                <p className="text-xs text-slate-400">{[row.campaignName, row.salesperson].filter(Boolean).join(" / ") || "Fara campanie"}</p>
              </div>
              <Badge tone={expired ? "red" : "yellow"}>{expired ? "Expirat" : row.status}</Badge>
            </div>

            <p className="mt-2 text-xs font-bold text-slate-300">
              {date(row.periodStart)} - {date(row.periodEnd)}{row.holdExpiresAt ? ` / expira ${dateTime(row.holdExpiresAt)}` : ""}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {canConfirmBooking ? (
                <button className="focus-button" type="button" disabled={busy === `confirmBooking-${row.id}`} onClick={() => command(row, "confirmBooking", {}, "Hold-ul a fost confirmat ca inchiriere.")}>
                  Confirma
                </button>
              ) : null}
              <button className="focus-button secondary" type="button" disabled={busy === `extendHold-${row.id}`} onClick={() => command(row, "extendHold", { days: 5 }, "Hold-ul a fost prelungit cu 5 zile.")}>
                Prelungeste
              </button>
              {!expired ? (
                <button className="focus-button secondary" type="button" disabled={busy === `changePeriod-${row.id}`} onClick={() => changePeriod(row)}>
                  Schimba perioada
                </button>
              ) : null}
              <button className="focus-button secondary" type="button" disabled={busy === `releaseHold-${row.id}`} onClick={() => command(row, "releaseHold", {}, "Locatia a fost eliberata.")}>
                Elibereaza
              </button>
              <button className="focus-button secondary" type="button" disabled={busy === `markLost-${row.id}`} onClick={() => command(row, "markLost", {}, "Hold-ul a fost marcat ca pierdut.")}>
                Pierdut
              </button>
              <Link className="focus-button secondary" href="/admin/locatii#rezervari">
                Detalii
              </Link>
            </div>
          </article>
        )) : (
          <div className="flex items-center gap-3 rounded-lg border border-focus-line bg-focus-navy/40 px-4 py-5 text-sm text-slate-300">
            <AlertTriangle className="h-5 w-5 shrink-0 text-focus-yellow" />
            Nu exista holduri pentru acest dashboard.
          </div>
        )}
      </div>
    </section>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: "yellow" | "red" }) {
  const className = tone === "red"
    ? "border-red-300/50 bg-red-400/10 text-red-100"
    : "border-focus-yellow/60 bg-focus-yellow/10 text-focus-yellow";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black uppercase ${className}`}>{children}</span>;
}

function Feedback({ children, tone }: { children: ReactNode; tone: "green" | "red" }) {
  const Icon = tone === "green" ? CheckCircle2 : XCircle;
  const className = tone === "green"
    ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
    : "border-red-300/30 bg-red-500/10 text-red-100";
  return <p className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold ${className}`}><Icon size={18} /> {children}</p>;
}

function date(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
