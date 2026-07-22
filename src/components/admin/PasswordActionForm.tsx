"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, KeyRound } from "lucide-react";

export function PasswordActionForm({ token, mode }: { token: string; mode: "invite" | "reset" }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) return setError("Confirmarea parolei nu corespunde.");
    setLoading(true);
    const response = await fetch(mode === "invite" ? "/api/auth/invite/accept" : "/api/auth/password-reset/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password })
    });
    const data = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) return setError(data?.error || "Actiunea nu a putut fi finalizata.");
    setDone(true);
  }

  if (done) {
    return <section className="focus-card mx-auto grid max-w-md gap-4 rounded-lg p-6 text-center"><CheckCircle2 className="mx-auto text-emerald-300" size={42} /><h1 className="font-display text-3xl font-black uppercase">Parola este activa</h1><p className="text-sm text-slate-300">Toate linkurile vechi si sesiunile anterioare nu mai pot fi folosite.</p><Link className="focus-button justify-center" href="/admin/login">Mergi la autentificare</Link></section>;
  }

  return <form className="focus-card mx-auto grid w-full max-w-md gap-4 rounded-lg p-6" onSubmit={submit}>
    <div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-lg bg-focus-yellow text-focus-navy"><KeyRound size={24} /></span><div><p className="text-xs font-black uppercase text-focus-yellow">Focus Media</p><h1 className="font-display text-3xl font-black uppercase">{mode === "invite" ? "Activeaza contul" : "Parola noua"}</h1></div></div>
    <p className="text-sm text-slate-300">Foloseste minimum 12 caractere. Linkul poate fi utilizat o singura data.</p>
    <label className="grid gap-2"><span className="text-sm font-bold">Parola</span><input className="focus-input" type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
    <label className="grid gap-2"><span className="text-sm font-bold">Confirma parola</span><input className="focus-input" type="password" minLength={12} maxLength={128} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
    {error ? <p className="rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-100">{error}</p> : null}
    <button className="focus-button" type="submit" disabled={loading}><KeyRound size={18} />{loading ? "Se salveaza..." : "Salveaza parola"}</button>
  </form>;
}
