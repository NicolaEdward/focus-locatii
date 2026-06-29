"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";

export function SelectionQualityWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) {
    return (
      <section className="rounded-lg border border-emerald-300/35 bg-emerald-400/10 p-3 text-sm font-bold text-emerald-100">
        <CheckCircle2 className="mr-2 inline h-4 w-4" />
        Selectia nu are avertizari majore.
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-amber-300/35 bg-amber-400/10 p-3 text-sm text-amber-100">
      <p className="font-black">
        <AlertTriangle className="mr-2 inline h-4 w-4" />
        Avertizari selectie
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {warnings.map((warning) => (
          <span key={warning} className="rounded-full border border-amber-200/30 bg-focus-navy/45 px-3 py-1 text-xs font-bold">
            {warning}
          </span>
        ))}
      </div>
    </section>
  );
}
