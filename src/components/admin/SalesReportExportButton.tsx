"use client";

import { useMemo, useState, type ReactNode } from "react";

type SalesReportExportButtonProps = {
  label?: string;
  icon?: ReactNode;
  variant?: "button" | "menu";
  className?: string;
};

export function SalesReportExportButton({
  label = "Export vanzari",
  icon,
  variant = "button",
  className
}: SalesReportExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const validationError = useMemo(() => {
    if (!from || !to) return "Alege data de inceput si data de final.";
    if (from > to) return "Data de final trebuie sa fie dupa data de inceput.";
    return null;
  }, [from, to]);

  function openDialog() {
    if (!from || !to) {
      const range = currentMonthRange();
      setFrom(range.from);
      setTo(range.to);
    }
    setOpen(true);
  }

  function applyRange(range: DateRange) {
    setFrom(range.from);
    setTo(range.to);
  }

  function exportReport() {
    if (validationError) return;
    const params = new URLSearchParams({ from, to });
    window.location.assign(`/api/admin/sales-report/excel?${params.toString()}`);
    setOpen(false);
  }

  const triggerClass =
    variant === "menu"
      ? "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-black text-slate-100 hover:bg-focus-yellow/10 hover:text-white"
      : className || "focus-button secondary";

  return (
    <>
      <button className={triggerClass} type="button" onClick={openDialog}>
        {icon}
        {label}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-focus-navy/80 px-4 py-8 backdrop-blur-sm">
          <div
            aria-labelledby="sales-export-period-title"
            aria-modal="true"
            className="w-full max-w-lg rounded-lg border border-focus-line bg-focus-ink p-5 shadow-2xl"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase text-focus-yellow">Financiar</p>
                <h2 id="sales-export-period-title" className="mt-1 text-2xl font-black text-white">
                  Situatie vanzari
                </h2>
                <p className="mt-2 text-sm font-bold leading-6 text-slate-300">
                  Alege perioada pentru export. Raportul va include vanzarile calculate pentru intervalul selectat.
                </p>
              </div>
              <button
                aria-label="Inchide"
                className="rounded-md border border-focus-line px-3 py-2 text-sm font-black text-slate-200 hover:bg-white/10"
                type="button"
                onClick={() => setOpen(false)}
              >
                X
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <button className="focus-button secondary justify-center" type="button" onClick={() => applyRange(currentMonthRange())}>
                Luna curenta
              </button>
              <button className="focus-button secondary justify-center" type="button" onClick={() => applyRange(previousMonthRange())}>
                Luna trecuta
              </button>
              <button className="focus-button secondary justify-center" type="button" onClick={() => applyRange(currentYearRange())}>
                Anul curent
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-xs font-black uppercase text-slate-400">De la</span>
                <input className="focus-input" max={to || undefined} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-black uppercase text-slate-400">Pana la</span>
                <input className="focus-input" min={from || undefined} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
              </label>
            </div>

            <p className="mt-3 min-h-5 text-sm font-bold text-red-100">{validationError || ""}</p>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button className="focus-button secondary" type="button" onClick={() => setOpen(false)}>
                Renunta
              </button>
              <button className="focus-button" disabled={Boolean(validationError)} type="button" onClick={exportReport}>
                Exporta
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

type DateRange = {
  from: string;
  to: string;
};

function currentMonthRange() {
  const now = new Date();
  return monthRange(now.getFullYear(), now.getMonth());
}

function previousMonthRange() {
  const now = new Date();
  return monthRange(now.getFullYear(), now.getMonth() - 1);
}

function currentYearRange() {
  const now = new Date();
  return {
    from: formatDateInput(new Date(now.getFullYear(), 0, 1)),
    to: formatDateInput(new Date(now.getFullYear(), 11, 31))
  };
}

function monthRange(year: number, monthIndex: number) {
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  return {
    from: formatDateInput(firstDay),
    to: formatDateInput(lastDay)
  };
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
