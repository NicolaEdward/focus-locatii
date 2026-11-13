"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, GraduationCap, Loader2, RotateCcw, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import type { workplaceGuide } from "@/lib/workplace-guide";
import type { OnboardingState } from "@/lib/workplace-onboarding";

export function WorkplaceOnboarding({ name, guide, initialState, canManageUsers }: { name: string; guide: ReturnType<typeof workplaceGuide>; initialState: OnboardingState; canManageUsers: boolean }) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const completed = new Set(state.completedStepIds);
  const next = guide.steps.find((step) => !completed.has(step.id));

  async function reload() {
    setPending("reload"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/onboarding", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.state) throw new Error(data.error || "Progresul nu poate fi încărcat.");
      setState(data.state);
      setNotice("Progresul salvat a fost reîncărcat.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Progresul nu poate fi încărcat."); }
    finally { setPending(null); }
  }

  async function toggle(stepId: string) {
    if (pending) return;
    setPending(stepId); setError(""); setNotice("");
    const stepIds = completed.has(stepId) ? state.completedStepIds.filter((id) => id !== stepId) : [...state.completedStepIds, stepId];
    try {
      const response = await fetch("/api/admin/onboarding", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: state.version, completedStepIds: stepIds }) });
      const data = await response.json();
      if (!response.ok || !data.state) throw new Error(data.error || "Salvarea nu a fost confirmată. Reîncarcă pentru a verifica rezultatul.");
      setState(data.state);
      setNotice("Progresul tău a fost salvat.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Salvarea nu a fost confirmată. Reîncarcă pentru a verifica rezultatul."); }
    finally { setPending(null); }
  }

  return <main className="focus-container min-w-0 space-y-6 py-7">
    <header className="rounded-xl border border-focus-line bg-focus-navy p-5 sm:p-7">
      <p className="flex items-center gap-2 text-xs font-black uppercase text-focus-yellow"><GraduationCap size={18} /> Ghid de lucru · {guide.roleLabel}</p>
      <h1 className="mt-3 text-2xl font-black text-white sm:text-3xl">{guide.title}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">{name.split(" ")[0]}, parcurge pașii împreună cu responsabilul tău, pe un dosar existent sau în mediul de test. Nu crea clienți, contracte sau încasări fictive în aplicația firmei.</p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-[12rem] flex-1"><p className="text-sm font-bold text-white">{completed.size} din {guide.steps.length} pași parcurși</p><progress className="mt-2 h-2 w-full max-w-md accent-emerald-400" max={guide.steps.length} value={completed.size} aria-label="Progresul ghidului" /></div>
        {next ? <Link className="focus-button" href={`#${next.id}`} prefetch={false}>Continuă cu pasul {guide.steps.findIndex((step) => step.id === next.id) + 1}<ArrowRight size={17} /></Link> : <p className="flex items-center gap-2 font-bold text-emerald-200"><CheckCircle2 size={19} /> Ai parcurs ghidul. Confirmă cu responsabilul că poți lucra independent.</p>}
      </div>
    </header>

    <aside className="flex gap-3 rounded-lg border border-focus-line p-4 text-sm leading-6 text-slate-300"><ShieldCheck className="mt-1 shrink-0 text-focus-yellow" size={20} /><p>Bifele sunt propria confirmare că ai parcurs pașii. Nu acordă permisiuni, nu validează contracte și nu confirmă automat executarea unei lucrări. Progresul se păstrează în contul tău, pentru rolul actual.</p></aside>
    {error ? <div role="alert" className="rounded-lg border border-red-300/50 bg-red-500/10 p-4 text-red-100"><p>{error}</p><button type="button" className="focus-button secondary mt-3" disabled={Boolean(pending)} onClick={() => void reload()}><RotateCcw size={16} /> Verifică progresul salvat</button></div> : null}
    {notice ? <p role="status" className="text-sm text-emerald-200">{notice}</p> : null}

    <ol className="grid min-w-0 gap-4 lg:grid-cols-2">
      {guide.steps.map((step, index) => <li key={step.id} id={step.id} className="scroll-mt-36 rounded-xl border border-focus-line bg-focus-navy/70 p-5">
        <div className="flex items-start gap-3"><span className={`mt-1 shrink-0 ${completed.has(step.id) ? "text-emerald-200" : "text-slate-400"}`}>{completed.has(step.id) ? <CheckCircle2 size={22} /> : <Circle size={22} />}</span><div className="min-w-0"><p className="text-xs font-black uppercase text-focus-yellow">Pasul {index + 1}</p><h2 className="mt-1 text-lg font-black text-white">{step.title}</h2></div></div>
        <p className="mt-4 text-sm leading-6 text-slate-300">{step.description}</p>
        <div className="mt-4 rounded-lg border border-focus-line bg-focus-ink/55 p-3"><p className="text-xs font-black uppercase text-slate-400">Ce verifici împreună cu responsabilul</p><p className="mt-2 text-sm leading-6 text-slate-200">{step.evidence}</p></div>
        <div className="mt-5 flex flex-wrap items-center gap-3"><Link className="focus-button secondary" href={step.href} prefetch={false}>{step.actionLabel}<ArrowRight size={16} /></Link><button type="button" className="focus-button secondary" aria-pressed={completed.has(step.id)} disabled={Boolean(pending)} onClick={() => void toggle(step.id)}>{pending === step.id ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}{completed.has(step.id) ? "Reiau acest pas" : "Am parcurs acest pas"}</button></div>
      </li>)}
    </ol>

    {canManageUsers ? <section className="rounded-xl border border-focus-line p-5"><h2 className="flex items-center gap-2 text-lg font-black text-white"><Users size={20} /> Primești un coleg nou?</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Creează sau trimite invitația din administrarea utilizatorilor, alocă rolul și portofoliul, apoi parcurgeți ghidul contului lui. Începeți cu un dosar real existent, fără operațiuni comerciale de probă în producție. Accesul și lucrul independent se confirmă separat de bifarea ghidului.</p><Link className="focus-button secondary mt-4" href="/admin/utilizatori" prefetch={false}>Echipă și invitații<ArrowRight size={16} /></Link></section> : null}
  </main>;
}
