"use client";

import { useEffect, useState } from "react";
import { Ban, CheckCircle2, LoaderCircle } from "lucide-react";

export type ActiveLocationOverride = {
  id: string;
  type: string;
  reason: string | null;
  periodStart: string;
  periodEnd: string | null;
} | null;

export function LocationAvailabilityControls({
  locationId,
  activeOverride,
  legacyBlock,
  onChanged
}: {
  locationId: string;
  activeOverride: ActiveLocationOverride;
  legacyBlock: { reason: string | null; from: string | null; until: string | null; notes: string | null };
  onChanged: () => void;
}) {
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const blocked = Boolean(activeOverride || legacyBlock.reason);

  useEffect(() => {
    setReason(activeOverride?.reason || legacyBlock.reason || "");
    setFrom(dateInput(activeOverride?.periodStart || legacyBlock.from));
    setUntil(dateInput(activeOverride?.periodEnd || legacyBlock.until));
    setNotes(legacyBlock.notes || "");
  }, [activeOverride, legacyBlock.from, legacyBlock.notes, legacyBlock.reason, legacyBlock.until]);

  async function updateBlock(nextBlocked: boolean) {
    if (nextBlocked && !reason.trim()) {
      setMessage("Completeaza motivul blocajului comercial.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/locations/${encodeURIComponent(locationId)}/block`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blocked: nextBlocked,
          blockedReason: nextBlocked ? reason.trim() : null,
          blockedFrom: nextBlocked ? from || null : null,
          blockedUntil: nextBlocked ? until || null : null,
          blockedNotes: nextBlocked ? notes.trim() || null : null
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Blocajul nu a putut fi actualizat.");
      setMessage(nextBlocked ? "Blocajul comercial a fost salvat." : "Locatia a fost deblocata comercial.");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Blocajul nu a putut fi actualizat.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-slate-300">Acesta este singurul control pentru blocajul comercial manual. Disponibilitatea din rezervari ramane calculata automat.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 md:col-span-2"><span className="text-xs font-black uppercase text-slate-400">Motiv</span><input className="focus-input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex: interventie tehnica / indisponibilitate proprietar" /></label>
        <label className="grid gap-1"><span className="text-xs font-black uppercase text-slate-400">De la</span><input className="focus-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="grid gap-1"><span className="text-xs font-black uppercase text-slate-400">Pana la</span><input className="focus-input" type="date" min={from || undefined} value={until} onChange={(event) => setUntil(event.target.value)} /></label>
        <label className="grid gap-1 md:col-span-2"><span className="text-xs font-black uppercase text-slate-400">Nota interna optionala</span><textarea className="focus-input min-h-20" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="focus-button secondary" type="button" disabled={saving} onClick={() => updateBlock(true)}>{saving ? <LoaderCircle className="animate-spin" size={17} /> : <Ban size={17} />} {blocked ? "Actualizeaza blocajul" : "Marcheaza indisponibila"}</button>
        {blocked ? <button className="focus-button secondary" type="button" disabled={saving} onClick={() => updateBlock(false)}><CheckCircle2 size={17} /> Marcheaza disponibila / activa</button> : null}
      </div>
      {message ? <p className="text-sm font-bold text-slate-200" role="status">{message}</p> : null}
    </div>
  );
}

function dateInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
