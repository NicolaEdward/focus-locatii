"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import { EscapeCloseHandler } from "@/hooks/use-escape-close";

export type ReservationPeriodChangeTarget = {
  id: string;
  locationId?: string | null;
  locationIds?: string[];
  locationLabel?: string | null;
  locationLabels?: string[];
  clientName?: string | null;
  campaignName?: string | null;
  periodStart: string;
  periodEnd: string;
};

type ConflictPreview = {
  conflicts: Array<{
    reservationId: string;
    locationId: string;
    locationCode: string | null;
    clientName: string | null;
    campaignName: string | null;
    status: string;
    periodStart: string;
    periodEnd: string;
  }>;
  warnings: Array<{
    locationId: string;
    locationCode: string | null;
    message: string;
  }>;
};

export function ReservationPeriodChangeDialog({
  target,
  onClose,
  onConfirm
}: {
  target: ReservationPeriodChangeTarget;
  onClose: () => void;
  onConfirm: (periodStart: string, periodEnd: string) => Promise<void> | void;
}) {
  const [periodStart, setPeriodStart] = useState(dateInputValue(target.periodStart));
  const [periodEnd, setPeriodEnd] = useState(dateInputValue(target.periodEnd));
  const [preview, setPreview] = useState<(ConflictPreview & { key: string }) | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewKey = `${target.id}|${periodStart}|${periodEnd}`;
  const currentPreview = preview?.key === previewKey ? preview : null;
  const validationError = useMemo(() => periodValidationError(periodStart, periodEnd), [periodStart, periodEnd]);
  const locationLabels = target.locationLabels?.length
    ? target.locationLabels
    : target.locationLabel
      ? [target.locationLabel]
      : [];
  const canSubmit = !saving && !validationError && currentPreview && currentPreview.conflicts.length === 0;

  async function runPreview() {
    setError(null);
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoadingPreview(true);
    try {
      const response = await fetch("/api/admin/reservations/conflict-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reservationId: target.id,
          locationIds: target.locationIds?.length ? target.locationIds : target.locationId ? [target.locationId] : undefined,
          periodStart,
          periodEnd
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Disponibilitatea nu a putut fi verificata.");
      setPreview({
        key: previewKey,
        conflicts: Array.isArray(payload?.conflicts) ? payload.conflicts : [],
        warnings: Array.isArray(payload?.warnings) ? payload.warnings : []
      });
    } catch (previewError) {
      setPreview(null);
      setError(previewError instanceof Error ? previewError.message : "Disponibilitatea nu a putut fi verificata.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function submit() {
    setError(null);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!currentPreview) {
      setError("Verifica disponibilitatea inainte de salvare.");
      return;
    }
    if (currentPreview.conflicts.length) {
      setError("Perioada are suprapuneri active si nu poate fi salvata.");
      return;
    }
    setSaving(true);
    try {
      await onConfirm(periodStart, periodEnd);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Perioada nu a putut fi salvata.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <EscapeCloseHandler onClose={onClose} enabled={!saving && !loadingPreview} />
      <div className="focus-card w-full max-w-2xl rounded-lg p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-black uppercase text-focus-yellow">
              <CalendarClock size={16} /> Schimbare perioada
            </p>
            <h2 className="font-display text-2xl font-black uppercase text-white">
              {target.clientName || "Rezervare"} {target.campaignName ? `- ${target.campaignName}` : ""}
            </h2>
            <p className="mt-1 text-sm font-bold text-slate-300">
              Perioada curenta: {dateLabel(target.periodStart)} - {dateLabel(target.periodEnd)}
            </p>
          </div>
          <button className="focus-button secondary" type="button" onClick={onClose} disabled={saving || loadingPreview}>
            Inchide
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-focus-line bg-focus-navy/35 p-3 text-sm font-bold text-slate-300">
          <p className="text-xs font-black uppercase text-focus-yellow">Locatii verificate</p>
          {locationLabels.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {locationLabels.map((label) => (
                <span className="rounded-full border border-focus-line bg-focus-ink/70 px-2.5 py-1 text-xs text-slate-100" key={label}>
                  {label}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1">Locatia rezervarii curente.</p>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold">
            Start nou
            <input className="focus-input" type="date" value={periodStart} onChange={(event) => {
              setPeriodStart(event.target.value);
              setPreview(null);
            }} />
          </label>
          <label className="grid gap-2 text-sm font-bold">
            Final nou
            <input className="focus-input" type="date" value={periodEnd} onChange={(event) => {
              setPeriodEnd(event.target.value);
              setPreview(null);
            }} />
          </label>
        </div>

        {validationError ? (
          <Feedback tone="red" text={validationError} />
        ) : null}
        {error ? <Feedback tone="red" text={error} /> : null}

        <div className="mt-4 grid gap-3">
          <button className="focus-button secondary justify-self-start" type="button" onClick={runPreview} disabled={loadingPreview || Boolean(validationError)}>
            {loadingPreview ? "Se verifica..." : "Verifica disponibilitatea"}
          </button>
          {currentPreview ? (
            <PreviewResult preview={currentPreview} />
          ) : (
            <p className="rounded-lg border border-focus-line bg-focus-navy/35 px-3 py-2 text-xs font-bold text-slate-400">
              Verifica disponibilitatea ca sa vezi suprapunerile inainte de salvare.
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-focus-line pt-4">
          <button className="focus-button secondary" type="button" onClick={onClose} disabled={saving || loadingPreview}>
            Renunta
          </button>
          <button className="focus-button" type="button" onClick={submit} disabled={!canSubmit}>
            {saving ? "Se salveaza..." : "Salveaza perioada"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewResult({ preview }: { preview: ConflictPreview }) {
  if (!preview.conflicts.length && !preview.warnings.length) {
    return <Feedback tone="green" text="Nu exista suprapuneri pentru perioada aleasa." />;
  }
  return (
    <div className="grid gap-3">
      {preview.conflicts.length ? (
        <div className="rounded-lg border border-red-300/30 bg-red-500/10 p-3">
          <p className="flex items-center gap-2 text-sm font-black text-red-100">
            <AlertTriangle size={16} /> Suprapuneri active
          </p>
          <div className="mt-2 grid gap-2">
            {preview.conflicts.map((conflict) => (
              <p className="text-xs font-bold text-red-50" key={`${conflict.reservationId}-${conflict.locationId}`}>
                {conflict.locationCode || conflict.locationId}: {conflict.clientName || "Client necunoscut"} / {conflict.campaignName || "Fara campanie"} / {conflict.status} ({dateLabel(conflict.periodStart)} - {dateLabel(conflict.periodEnd)})
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {preview.warnings.length ? (
        <div className="rounded-lg border border-amber-300/40 bg-amber-400/10 p-3">
          <p className="text-sm font-black text-amber-100">Atentionari</p>
          <div className="mt-2 grid gap-2">
            {preview.warnings.map((warning) => (
              <p className="text-xs font-bold text-amber-50" key={`${warning.locationId}-${warning.message}`}>
                {warning.locationCode || warning.locationId}: {warning.message}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Feedback({ tone, text }: { tone: "green" | "red"; text: string }) {
  const Icon = tone === "green" ? CheckCircle2 : XCircle;
  return (
    <p className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${tone === "green" ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-red-300/30 bg-red-500/10 text-red-100"}`}>
      <Icon size={16} /> {text}
    </p>
  );
}

function periodValidationError(periodStart: string, periodEnd: string) {
  if (!periodStart || !periodEnd) return "Completeaza ambele date.";
  const start = Date.parse(`${periodStart}T00:00:00.000Z`);
  const end = Date.parse(`${periodEnd}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Datele nu sunt valide.";
  if (end < start) return "Data de final nu poate fi inainte de data de start.";
  return null;
}

function dateInputValue(value: string) {
  return value ? value.slice(0, 10) : "";
}

function dateLabel(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
