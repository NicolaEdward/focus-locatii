"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CheckCircle2, PhoneCall } from "lucide-react";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: string;
  status: string;
  dueDate: string | null;
  recommendedAction: string | null;
  createdAt: string;
  user?: { name: string; email: string } | null;
};

export function NotificationBell() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadRows = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/notifications", { cache: "no-store", signal });
      const payload = response.ok ? await response.json() : null;
      if (Array.isArray(payload?.notifications)) setRows(payload.notifications);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadRows(controller.signal);
    const interval = window.setInterval(() => void loadRows(), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [loadRows]);

  const activeRows = useMemo(() => rows.filter((row) => row.status !== "resolved").slice(0, 12), [rows]);

  async function action(id: string, actionName: string) {
    setBusy(`${id}-${actionName}`);
    try {
      const response = await fetch(`/api/admin/notifications/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: actionName })
      });
      if (response.ok) setRows((current) => current.map((row) => row.id === id ? { ...row, status: "resolved" } : row));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button
        className="focus-button secondary"
        type="button"
        aria-label="Notificari"
        aria-expanded={open}
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          if (nextOpen) void loadRows();
        }}
      >
        <Bell size={18} />
        Notificari
        {activeRows.length ? <span className="rounded-full bg-focus-yellow px-2 py-0.5 text-xs text-focus-navy">{activeRows.length}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-[min(92vw,420px)] rounded-lg border border-focus-line bg-focus-navy p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-3 border-b border-focus-line pb-2">
            <strong className="text-sm uppercase text-focus-yellow">Notificari</strong>
            <button className="text-xs font-bold text-slate-300" type="button" onClick={() => setOpen(false)}>Inchide</button>
          </div>
          <div className="max-h-[min(24rem,calc(100vh-7rem))] overflow-auto">
            {activeRows.length ? activeRows.map((row) => (
              <article className="grid gap-2 border-b border-focus-line py-3 text-sm last:border-b-0" key={row.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-white">{row.title}</p>
                    <p className="text-xs text-slate-300">{row.message}</p>
                    <p className="mt-1 text-xs text-slate-400">{row.recommendedAction || ""}{row.user?.name ? ` / Owner: ${row.user.name}` : ""}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{formatNotificationDate(row.createdAt)}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase ${row.severity === "high" ? "border-red-300/50 bg-red-400/10 text-red-100" : "border-focus-yellow/60 bg-focus-yellow/10 text-focus-yellow"}`}>
                    {row.severity}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.type.startsWith("receivable_") ? <button className="focus-button secondary" type="button" disabled={busy === `${row.id}-called`} onClick={() => action(row.id, "called")}><PhoneCall size={14} /> Am sunat</button> : null}
                  <button className="focus-button" type="button" disabled={busy === `${row.id}-resolve`} onClick={() => action(row.id, "resolve")}><CheckCircle2 size={14} /> Rezolvat</button>
                </div>
              </article>
            )) : <p className="py-8 text-center text-sm font-bold text-slate-400">Nu exista notificari active.</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatNotificationDate(value: string) {
  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
