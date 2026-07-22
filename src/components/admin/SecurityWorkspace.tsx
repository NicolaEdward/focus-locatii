"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Link2, ShieldCheck, Smartphone, Trash2 } from "lucide-react";

type SecurityState = {
  mfa: { enrolled: boolean; enabledAt: string | null; recoveryCodesRemaining: number };
  sessions: Array<{
    id: string;
    userAgent: string | null;
    mfaVerifiedAt: string | null;
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
    current: boolean;
  }>;
};

export function SecurityWorkspace({ initialState }: { initialState: SecurityState }) {
  const [state, setState] = useState(initialState);
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function beginEnrollment() {
    setBusy(true); setError(null); setMessage(null);
    const response = await fetch("/api/auth/security/mfa/enroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword }) });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) return setError(payload?.error || "Configurarea nu a pornit.");
    setSecret(payload.secret); setUri(payload.uri); setCurrentPassword("");
  }

  async function confirmEnrollment(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    const response = await fetch("/api/auth/security/mfa/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code })
    });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) return setError(payload?.error || "Codul nu a fost confirmat.");
    setRecoveryCodes(payload.recoveryCodes || []);
    setSecret(null); setUri(null); setCode("");
    await refresh();
    setMessage("MFA este activ. Pastreaza codurile de recuperare intr-un loc sigur.");
  }

  async function revokeSession(id: string, current: boolean) {
    setBusy(true); setError(null);
    const response = await fetch(`/api/auth/security/sessions/${id}/revoke`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) return setError(payload?.error || "Sesiunea nu a putut fi revocata.");
    if (current) { window.location.href = "/admin/login"; return; }
    await refresh();
    setMessage("Sesiunea a fost revocata.");
  }

  async function refresh() {
    const response = await fetch("/api/auth/security", { cache: "no-store" });
    if (response.ok) setState(await response.json());
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setMessage("Copiat.");
  }

  return <main className="focus-shell py-8"><div className="focus-container grid gap-6">
    <section className="border-b border-focus-line pb-5"><p className="text-xs font-black uppercase text-focus-yellow">Contul meu</p><h1 className="font-display text-4xl font-black uppercase">Securitate si sesiuni</h1><p className="mt-2 max-w-2xl text-sm text-slate-300">Activeaza autentificarea in doi pasi si inchide dispozitivele pe care nu le mai folosesti.</p></section>
    {message ? <p className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-100">{message}</p> : null}
    {error ? <p className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-100">{error}</p> : null}

    <section className="grid gap-5 lg:grid-cols-2">
      <article className="focus-card grid content-start gap-4 rounded-lg p-5">
        <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-focus-yellow text-focus-navy"><ShieldCheck size={22} /></span><div><h2 className="font-display text-2xl font-black uppercase">Autentificare MFA</h2><p className="text-sm text-slate-300">Cod TOTP nou la fiecare 30 de secunde.</p></div></div>
        {state.mfa.enrolled ? <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-4"><p className="flex items-center gap-2 font-black text-emerald-200"><Check size={18} />MFA activ</p><p className="mt-1 text-sm text-slate-300">Coduri de recuperare ramase: {state.mfa.recoveryCodesRemaining}</p></div> : null}
        {!state.mfa.enrolled && !secret ? <div className="grid gap-3"><label className="grid gap-2"><span className="text-sm font-bold">Confirma parola curenta</span><input className="focus-input" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><button className="focus-button" type="button" disabled={busy || !currentPassword} onClick={beginEnrollment}><Smartphone size={18} />{busy ? "Se pregateste..." : "Configureaza MFA"}</button></div> : null}
        {secret ? <form className="grid gap-4 rounded-lg border border-focus-line bg-focus-navy/50 p-4" onSubmit={confirmEnrollment}>
          <p className="text-sm text-slate-200">Adauga manual cheia in Google Authenticator, Microsoft Authenticator sau o aplicatie TOTP compatibila.</p>
          <div className="flex min-w-0 items-center gap-2 rounded-md bg-black/25 p-3"><code className="min-w-0 flex-1 break-all text-focus-yellow">{secret}</code><button className="focus-button secondary shrink-0" type="button" onClick={() => copy(secret)} aria-label="Copiaza cheia" title="Copiaza cheia"><Copy size={17} /></button></div>
          {uri ? <a className="focus-button secondary justify-center" href={uri}><Link2 size={17} />Deschide aplicatia TOTP</a> : null}
          <label className="grid gap-2"><span className="text-sm font-bold">Codul de verificare</span><input className="focus-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} required /></label>
          <button className="focus-button" type="submit" disabled={busy}><KeyRound size={18} />{busy ? "Se verifica..." : "Activeaza MFA"}</button>
        </form> : null}
        {recoveryCodes.length ? <div className="grid gap-3 rounded-lg border border-amber-300/40 bg-amber-300/10 p-4"><p className="font-black text-amber-100">Aceste coduri sunt afisate o singura data.</p><div className="grid grid-cols-2 gap-2 font-mono text-sm">{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div><button className="focus-button secondary" type="button" onClick={() => copy(recoveryCodes.join("\n"))}><Copy size={17} />Copiaza codurile</button></div> : null}
      </article>

      <article className="focus-card grid content-start gap-4 rounded-lg p-5">
        <div><h2 className="font-display text-2xl font-black uppercase">Sesiuni active</h2><p className="text-sm text-slate-300">Sesiunile noi pot fi revocate separat. Cele anterioare rollout-ului expira normal in maximum 12 ore.</p></div>
        <div className="grid gap-3">{state.sessions.filter((session) => !session.revokedAt).map((session) => <div key={session.id} className="grid gap-3 rounded-lg border border-focus-line bg-focus-navy/45 p-4 sm:grid-cols-[1fr_auto] sm:items-center"><div className="min-w-0"><p className="font-bold text-white">{deviceLabel(session.userAgent)} {session.current ? <span className="text-focus-yellow">/ sesiunea curenta</span> : null}</p><p className="mt-1 text-xs text-slate-400">Pornita {formatDate(session.createdAt)} / expira {formatDate(session.expiresAt)}{session.mfaVerifiedAt ? " / MFA" : ""}</p></div><button className="focus-button secondary" type="button" disabled={busy} onClick={() => revokeSession(session.id, session.current)} title="Revoca sesiunea"><Trash2 size={17} />Revoca</button></div>)}</div>
      </article>
    </section>
  </div></main>;
}

function deviceLabel(userAgent: string | null) {
  const value = userAgent || "Dispozitiv necunoscut";
  const browser = /Edg\//.test(value) ? "Edge" : /Chrome\//.test(value) ? "Chrome" : /Firefox\//.test(value) ? "Firefox" : /Safari\//.test(value) ? "Safari" : "Browser";
  const device = /Mobile|Android|iPhone/.test(value) ? "mobil" : "desktop";
  return `${browser} / ${device}`;
}
function formatDate(value: string) { return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
