"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  FileText,
  LoaderCircle,
  MapPin,
  ReceiptText,
  Search,
  UserRound,
  Wrench,
  X
} from "lucide-react";
import type {
  ExecutiveSearchEntity,
  ExecutiveSearchResponse,
  ExecutiveSearchResult
} from "@/lib/dashboard/executive/refinement-contracts";

const entityLabels: Record<ExecutiveSearchEntity, string> = {
  CLIENT: "Client",
  CAMPAIGN: "Campanie",
  RESERVATION: "Rezervare",
  LOCATION: "Locație",
  INVOICE: "Factură",
  PAYMENT: "Încasare",
  CONTRACT: "Contract",
  CRM: "CRM",
  USER: "Utilizator",
  TASK: "Task",
  DOCUMENT: "Document"
};

export function ExecutiveGlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ExecutiveSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/executive/search?q=${encodeURIComponent(query.trim())}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = await response.json() as ExecutiveSearchResponse;
        if (response.ok) {
          setResults(payload.items);
          setOpen(true);
        }
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, []);

  return (
    <div className="relative min-w-0" ref={root}>
      <label className="relative block">
        <span className="sr-only">Căutare executivă globală</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
        <input
          aria-autocomplete="list"
          aria-controls="executive-search-results"
          aria-expanded={open}
          className="focus-input min-h-11 w-full pl-10 pr-10"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder="Caută client, campanie, locație, factură, task..."
          role="combobox"
          value={query}
        />
        {loading
          ? <LoaderCircle className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-focus-yellow" size={17} />
          : query
            ? <button aria-label="Șterge căutarea" className="absolute right-2 top-1/2 grid min-h-9 min-w-9 -translate-y-1/2 place-items-center text-slate-400 hover:text-white" onClick={() => { setQuery(""); setResults([]); }} type="button"><X size={16} /></button>
            : null}
      </label>

      {open && query.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[min(65vh,560px)] overflow-y-auto rounded-lg border border-focus-line bg-focus-navy p-2 shadow-2xl" id="executive-search-results" role="listbox">
          {results.length ? results.map((item) => (
            <Link
              className="grid min-h-14 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 hover:bg-white/[0.06]"
              href={item.href}
              key={`${item.entity}:${item.id}`}
              onClick={() => setOpen(false)}
              prefetch={false}
              role="option"
            >
              <span className="grid h-9 w-9 place-items-center rounded border border-white/10 text-focus-yellow">{searchIcon(item.entity)}</span>
              <span className="min-w-0"><strong className="block truncate text-sm text-white">{item.label}</strong><small className="block truncate text-slate-400">{item.context}</small></span>
              <span className="text-[10px] font-black uppercase text-slate-500">{entityLabels[item.entity]}</span>
            </Link>
          )) : loading ? null : (
            <p className="p-4 text-sm text-slate-400">Nu am găsit înregistrări în registrele la care ai acces.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function searchIcon(entity: ExecutiveSearchEntity) {
  if (entity === "CLIENT") return <Building2 size={17} />;
  if (entity === "CAMPAIGN" || entity === "CRM") return <BriefcaseBusiness size={17} />;
  if (entity === "LOCATION" || entity === "RESERVATION") return <MapPin size={17} />;
  if (entity === "INVOICE" || entity === "PAYMENT") return <ReceiptText size={17} />;
  if (entity === "USER") return <UserRound size={17} />;
  if (entity === "TASK") return <Wrench size={17} />;
  if (entity === "CONTRACT" || entity === "DOCUMENT") return <FileText size={17} />;
  return <CalendarClock size={17} />;
}
