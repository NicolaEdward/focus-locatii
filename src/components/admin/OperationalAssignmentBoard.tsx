"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CheckSquare, MapPin, ShieldCheck, UserRoundCheck } from "lucide-react";
import type { OperationalAssignmentDryRun, OperationalAssignmentTaskDto } from "@/lib/operational-assignment";

type FieldUser = { id: string; name: string };

export function OperationalAssignmentBoard({ tasks, fieldUsers }: { tasks: OperationalAssignmentTaskDto[]; fieldUsers: FieldUser[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState<"ALL" | "UNASSIGNED" | "ASSIGNED">("UNASSIGNED");
  const [dryRun, setDryRun] = useState<OperationalAssignmentDryRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const visible = useMemo(() => tasks.filter((task) => {
    if (filter === "UNASSIGNED") return !task.assignedTo;
    if (filter === "ASSIGNED") return Boolean(task.assignedTo);
    return true;
  }), [filter, tasks]);
  const visibleKeys = visible.map((task) => task.taskKey);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.includes(key));

  function toggleTask(taskKey: string) {
    setSelected((current) => current.includes(taskKey) ? current.filter((key) => key !== taskKey) : [...current, taskKey]);
    setDryRun(null);
  }

  function toggleVisible() {
    setSelected((current) => allVisibleSelected
      ? current.filter((key) => !visibleKeys.includes(key))
      : [...new Set([...current, ...visibleKeys])]);
    setDryRun(null);
  }

  async function requestDryRun() {
    if (!selected.length || !assigneeUserId) {
      setMessage("Selecteaza lucrarile si responsabilul de teren.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/operational/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "dry-run", taskKeys: selected, assigneeUserId })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Dry-run indisponibil.");
      setDryRun(payload.dryRun);
      setMessage("Impact verificat. Nicio lucrare nu a fost modificata.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dry-run indisponibil.");
    } finally {
      setBusy(false);
    }
  }

  async function applyAssignment() {
    if (!dryRun || dryRun.blocked.length || dryRun.changeCount < 1) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/operational/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "apply",
          taskKeys: selected,
          assigneeUserId,
          expectedBatchId: dryRun.batchId,
          reason,
          confirmation: "ATRIBUIE TASKURILE OPERATIONALE"
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Assignmentul a esuat.");
      setSelected([]);
      setDryRun(null);
      setReason("");
      setMessage(`${payload.result.updated} lucrari au fost atribuite si auditate.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Assignmentul a esuat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="w-full min-w-0 max-w-full rounded-lg border border-slate-700 bg-focus-navy p-4 sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Control assignment</p>
          <h2 className="text-2xl font-black text-white">Lucrari de atribuit</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">Doar taskurile atribuite apar in Munca mea. Atribuirea este precedata obligatoriu de dry-run.</p>
        </div>
        <div className="grid w-full min-w-0 grid-cols-3 gap-2 xl:w-auto" role="group" aria-label="Filtru assignment">
          {(["ALL", "UNASSIGNED", "ASSIGNED"] as const).map((value) => (
            <button key={value} type="button" className={`focus-button min-w-0 px-2 ${filter === value ? "" : "secondary"}`} onClick={() => setFilter(value)}>
              {value === "ALL" ? "Toate" : value === "UNASSIGNED" ? "Nealocate" : "Atribuite"}
            </button>
          ))}
        </div>
      </div>

      {message ? <p role="status" aria-live="polite" className="mt-4 rounded-md border border-focus-line px-3 py-2 text-sm text-white">{message}</p> : null}

      <div className="mt-5 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-bold text-slate-300">{visible.length} lucrari - {selected.length} selectate</p>
            <button type="button" className="focus-button secondary" onClick={toggleVisible} disabled={!visible.length}>
              <CheckSquare size={17} />{allVisibleSelected ? "Deselecteaza vizibile" : "Selecteaza vizibile"}
            </button>
          </div>
          <div className="grid gap-2">
            {visible.map((task) => (
              <label key={task.taskKey} className="grid cursor-pointer gap-3 rounded-md border border-slate-700 bg-slate-950/30 p-3 sm:grid-cols-[24px_minmax(0,1fr)_auto] sm:items-center">
                <input type="checkbox" checked={selected.includes(task.taskKey)} onChange={() => toggleTask(task.taskKey)} className="h-5 w-5 accent-yellow-400" />
                <span className="min-w-0">
                  <span className="block font-black text-white">{task.location.code} - {kindLabel(task.kind)}</span>
                  <span className="mt-1 block text-xs text-slate-300">{task.clientName} - {task.campaignName || "Fara campanie"}</span>
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400"><span><CalendarDays className="mr-1 inline h-3.5 w-3.5" />{dateLabel(task.scheduledFor)}</span><span><MapPin className="mr-1 inline h-3.5 w-3.5" />{task.location.city || "-"}</span></span>
                </span>
                <span className={`w-fit rounded px-2 py-1 text-xs font-black ${task.assignedTo ? "bg-emerald-950 text-emerald-200" : "bg-amber-950 text-amber-200"}`}>
                  {task.assignedTo?.name || "Nealocata"}
                </span>
              </label>
            ))}
            {!visible.length ? <p className="rounded-md border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">Nu exista lucrari in acest filtru.</p> : null}
          </div>
        </div>

        <aside className="h-fit w-full min-w-0 max-w-full rounded-lg border border-focus-line bg-slate-950/40 p-4 xl:sticky xl:top-4">
          <h3 className="flex items-center gap-2 text-lg font-black text-white"><UserRoundCheck size={19} />Assignment controlat</h3>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-xs font-bold uppercase text-slate-300">Responsabil teren
              <select className="focus-input w-full min-w-0 max-w-full" value={assigneeUserId} onChange={(event) => { setAssigneeUserId(event.target.value); setDryRun(null); }}>
                <option value="">Alege Field Operator</option>
                {fieldUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-bold uppercase text-slate-300">Motiv assignment
              <textarea className="focus-input min-h-20 w-full min-w-0 max-w-full resize-y" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex: planificare echipa teren saptamana curenta" />
            </label>
            <button type="button" className="focus-button secondary" onClick={requestDryRun} disabled={busy || !selected.length || !assigneeUserId} aria-busy={busy}>
              <ShieldCheck size={17} />Verifica impactul
            </button>
          </div>
          {dryRun ? (
            <div className="mt-4 rounded-md border border-slate-700 p-3 text-sm text-slate-300">
              <p><strong className="text-white">{dryRun.changeCount}</strong> modificari - {dryRun.createCount} taskuri materializate - {dryRun.reassignCount} realocari</p>
              <p className="mt-1">Blocate: <strong className={dryRun.blocked.length ? "text-rose-200" : "text-emerald-200"}>{dryRun.blocked.length}</strong></p>
              <p className="mt-2 break-all font-mono text-xs text-slate-500">{dryRun.batchId}</p>
              <button type="button" className="focus-button mt-3 w-full" onClick={applyAssignment} disabled={busy || dryRun.blocked.length > 0 || dryRun.changeCount < 1 || reason.trim().length < 10}>
                Atribuie lucrarile
              </button>
            </div>
          ) : null}
        </aside>
      </div>
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
