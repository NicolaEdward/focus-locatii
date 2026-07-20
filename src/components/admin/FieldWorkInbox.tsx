"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Camera, CheckCircle2, Clock3, MapPin, Play, Trash2, Upload } from "lucide-react";
import type { OperationalAssignmentTaskDto } from "@/lib/operational-assignment";

type PreviewFile = { file: File; url: string };

export function FieldWorkInbox({ initialTasks }: { initialTasks: OperationalAssignmentTaskDto[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [target, setTarget] = useState<OperationalAssignmentTaskDto | null>(null);
  const [files, setFiles] = useState<PreviewFile[]>([]);
  const filesRef = useRef<PreviewFile[]>([]);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const active = useMemo(() => tasks.filter((task) => task.status === "NEW" || task.status === "IN_PROGRESS"), [tasks]);
  const completed = useMemo(() => tasks.filter((task) => task.status === "DONE"), [tasks]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => () => filesRef.current.forEach((item) => URL.revokeObjectURL(item.url)), []);

  function chooseFiles(nextFiles: FileList | null) {
    if (!nextFiles) return;
    const next = [...nextFiles].map((file) => ({ file, url: URL.createObjectURL(file) }));
    setFiles((current) => [...current, ...next].slice(0, 10));
  }

  function removeFile(index: number) {
    setFiles((current) => {
      const item = current[index];
      if (item) URL.revokeObjectURL(item.url);
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  }

  function closeCompletion() {
    files.forEach((item) => URL.revokeObjectURL(item.url));
    setFiles([]);
    setNote("");
    setTarget(null);
  }

  async function markInProgress(task: OperationalAssignmentTaskDto) {
    if (!task.operationTaskId) return;
    setBusyId(task.operationTaskId);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/operational/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationTaskId: task.operationTaskId, status: "IN_PROGRESS" })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Statusul nu a putut fi salvat.");
      setTasks((current) => current.map((item) => item.operationTaskId === task.operationTaskId ? { ...item, status: "IN_PROGRESS" } : item));
      setMessage("Lucrarea a fost marcata In lucru.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Statusul nu a putut fi salvat.");
    } finally {
      setBusyId(null);
    }
  }

  async function completeTask() {
    if (!target?.operationTaskId || files.length < 1) {
      setMessage("Incarca cel putin o poza dovada pentru finalizare.");
      return;
    }
    setBusyId(target.operationTaskId);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("operationTaskId", target.operationTaskId);
      form.set("reservationId", target.reservationId);
      form.set("kind", target.kind === "NEUTRALIZATION" ? "neutralization" : "decoration");
      if (target.legacyTaskId) form.set("taskId", target.legacyTaskId);
      if (note.trim()) form.set("completionNote", note.trim());
      for (const item of files) form.append("files", item.file);
      const response = await fetch("/api/admin/operational/tasks/complete", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Lucrarea nu a putut fi finalizata.");
      setTasks((current) => current.map((item) => item.operationTaskId === target.operationTaskId
        ? { ...item, status: "DONE", completedAt: new Date().toISOString(), proofPhotos: payload.proofPhotos || item.proofPhotos }
        : item));
      closeCompletion();
      setMessage("Lucrarea a fost marcata ca finalizata.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lucrarea nu a putut fi finalizata.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <div className="border-b border-slate-700 pb-5">
        <p className="text-xs font-black uppercase text-focus-yellow">Teren</p>
        <h1 className="text-3xl font-black text-white">Munca mea</h1>
        <p className="mt-2 text-sm text-slate-300">Vezi numai lucrarile atribuite tie. Pentru finalizare este obligatorie cel putin o poza.</p>
      </div>
      {message ? <p role="status" aria-live="polite" className="mt-4 rounded-md border border-focus-line bg-focus-navy p-3 text-sm text-white">{message}</p> : null}

      <div className="mt-5 grid gap-4">
        {active.map((task) => (
          <article key={task.taskKey} className="rounded-lg border border-slate-700 bg-focus-navy p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-focus-yellow">{kindLabel(task.kind)}</p>
                <h2 className="mt-1 text-2xl font-black text-white">{task.location.code}</h2>
                <p className="text-sm text-slate-300">{task.location.address || task.location.city || "Locatie"}</p>
              </div>
              <span className={`rounded px-3 py-2 text-xs font-black uppercase ${task.overdue ? "bg-rose-950 text-rose-100" : task.status === "IN_PROGRESS" ? "bg-amber-950 text-amber-100" : "bg-slate-800 text-slate-200"}`}>
                {task.overdue ? "Intarziat" : task.status === "IN_PROGRESS" ? "In lucru" : "De facut"}
              </span>
            </div>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex items-center gap-2 text-slate-300"><CalendarDays className="h-4 w-4 text-focus-yellow" /><span>{dateLabel(task.scheduledFor)}</span></div>
              <div className="flex items-center gap-2 text-slate-300"><MapPin className="h-4 w-4 text-focus-yellow" /><span>{task.location.city || "-"}</span></div>
              <div className="text-slate-300"><dt className="text-xs uppercase text-slate-500">Client</dt><dd className="font-bold text-white">{task.clientName}</dd></div>
              <div className="text-slate-300"><dt className="text-xs uppercase text-slate-500">Campanie</dt><dd className="font-bold text-white">{task.campaignName || "-"}</dd></div>
            </dl>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {task.status === "NEW" ? (
                <button type="button" className="focus-button secondary min-h-12" onClick={() => markInProgress(task)} disabled={busyId === task.operationTaskId}>
                  <Play size={18} />Incepe lucrarea
                </button>
              ) : <span className="flex min-h-12 items-center gap-2 rounded-md border border-slate-700 px-4 text-sm font-bold text-slate-300"><Clock3 size={18} />Lucrare pornita</span>}
              <button type="button" className="focus-button min-h-12" onClick={() => setTarget(task)} disabled={busyId === task.operationTaskId}>
                <Camera size={18} />Finalizeaza cu poze
              </button>
            </div>
          </article>
        ))}
        {!active.length ? <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" /><p className="mt-3 font-black text-white">Nu ai lucrari active atribuite.</p></div> : null}
      </div>

      <details className="mt-6 rounded-lg border border-slate-700 bg-focus-navy p-4">
        <summary className="cursor-pointer font-black text-white">Finalizate recent ({completed.length})</summary>
        <div className="mt-4 grid gap-3">
          {completed.map((task) => <div key={task.taskKey} className="rounded-md border border-slate-700 p-3 text-sm"><p className="font-black text-white">{task.location.code} - {kindLabel(task.kind)}</p><p className="text-slate-400">{task.completedAt ? dateTimeLabel(task.completedAt) : dateLabel(task.scheduledFor)}</p>{task.proofPhotos.map((photo) => <a key={photo.id} href={photo.downloadUrl} className="mt-2 mr-2 inline-flex text-focus-yellow underline">{photo.fileName}</a>)}</div>)}
          {!completed.length ? <p className="text-sm text-slate-400">Nu exista lucrari finalizate recent.</p> : null}
        </div>
      </details>

      {target ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="field-completion-title">
          <div className="mx-auto max-w-xl rounded-lg border border-focus-line bg-focus-dark p-4 sm:p-6">
            <h2 id="field-completion-title" className="text-2xl font-black text-white">Finalizeaza {target.location.code}</h2>
            <p className="mt-2 text-sm text-slate-300">Pozele sunt pastrate 30 de zile si nu apar public.</p>
            <label className="mt-5 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-600 p-5 text-center text-sm font-bold text-white">
              <Upload className="mb-2 h-7 w-7 text-focus-yellow" />Adauga poze JPG, PNG sau WebP
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { chooseFiles(event.target.files); event.currentTarget.value = ""; }} />
            </label>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {files.map((item, index) => (
                <div key={`${item.file.name}-${item.file.lastModified}-${index}`} className="relative aspect-square overflow-hidden rounded-md border border-slate-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={`Previzualizare ${item.file.name}`} className="h-full w-full object-cover" />
                  <button type="button" aria-label={`Elimina ${item.file.name}`} onClick={() => removeFile(index)} className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded bg-black/80 text-white"><Trash2 size={17} /></button>
                </div>
              ))}
            </div>
            <label className="mt-4 grid gap-1 text-sm font-bold text-slate-300">Nota finalizare
              <textarea className="focus-input min-h-24" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional: observatii despre lucrare" />
            </label>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button type="button" className="focus-button secondary" onClick={closeCompletion} disabled={busyId === target.operationTaskId}>Renunta</button>
              <button type="button" className="focus-button" onClick={completeTask} disabled={busyId === target.operationTaskId || files.length < 1} aria-busy={busyId === target.operationTaskId}>
                {busyId === target.operationTaskId ? "Se salveaza..." : "Marcheaza finalizat"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function kindLabel(kind: OperationalAssignmentTaskDto["kind"]) {
  if (kind === "NEUTRALIZATION") return "Neutralizare";
  if (kind === "REDECORATION") return "Redecorare";
  return "Decorare";
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
