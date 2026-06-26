"use client";

import { useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import type { ImportSummary } from "@/types/location";

export function ImportExcelPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setSummary(null);

    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/import/excel", {
      method: "POST",
      body: form
    });

    const data = await response.json().catch(() => null);
    setLoading(false);

    if (!response.ok) {
      setError(data?.error || "Import failed.");
      return;
    }

    setSummary(data.summary);
  }

  return (
    <section className="focus-card grid gap-5 rounded-lg p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-lg bg-focus-yellow text-focus-navy">
          <FileSpreadsheet size={24} />
        </span>
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Excel import</p>
          <h1 className="font-display text-4xl font-black uppercase">Import locatii</h1>
        </div>
      </div>

      <label className="grid gap-2">
        <span className="text-sm font-bold">Fisier Excel</span>
        <input
          className="focus-input"
          type="file"
          accept=".xlsx,.xls"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
      </label>

      <button className="focus-button w-fit" type="button" onClick={upload} disabled={!file || loading}>
        <Upload size={18} />
        {loading ? "Se importa..." : "Upload & import"}
      </button>

      {error ? <p className="rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-100">{error}</p> : null}

      {summary ? (
        <div className="grid gap-3 md:grid-cols-5">
          <Stat label="Total" value={summary.totalRows} />
          <Stat label="Create" value={summary.createdCount} />
          <Stat label="Update" value={summary.updatedCount} />
          <Stat label="Fara GPS" value={summary.missingGpsCount} />
          <Stat label="Suspecte" value={summary.suspectGpsCount} />
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-focus-line p-4">
      <p className="text-xs font-black uppercase text-focus-yellow">{label}</p>
      <p className="font-display text-3xl font-black">{value}</p>
    </div>
  );
}
