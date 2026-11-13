"use client";

import { useState } from "react";
import { ArrowLeft, Copy, KeyRound, Link2, Lock, LogIn, Mail, ShieldCheck } from "lucide-react";
import { safeLoginContinuation } from "@/lib/login-continuation";

type Step = "credentials" | "mfa" | "enrollment" | "recovery" | "reset";

export function LoginForm({ passwordResetAvailable, returnTo }: { passwordResetAvailable: boolean; returnTo?: string }) {
  // The welcome guide and validated OAuth consent are the only continuations.
  const continuation = safeLoginContinuation(returnTo);
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [enrollmentToken, setEnrollmentToken] = useState("");
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [redirectTo, setRedirectTo] = useState("/admin/dashboard");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "Operația nu a reușit. Încearcă din nou.");
    return data;
  }

  async function beginRequiredEnrollment(token: string) {
    const data = await post("/api/auth/mfa/enroll-required", { enrollmentToken: token });
    setEnrollment({ secret: data.secret, uri: data.uri });
  }

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(null); setMessage(null);
    try {
      const data = await post("/api/auth/login", { email, password });
      setPassword(""); setMfaCode("");
      if (data?.mfaRequired && data?.challengeToken) {
        setChallengeToken(data.challengeToken); setStep("mfa"); return;
      }
      if (data?.mfaEnrollmentRequired && data?.enrollmentToken) {
        setEnrollmentToken(data.enrollmentToken); setStep("enrollment");
        await beginRequiredEnrollment(data.enrollmentToken); return;
      }
      window.location.href = continuation || data?.redirectTo || "/admin/dashboard";
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Autentificarea nu a reușit."); }
    finally { setLoading(false); }
  }

  async function submitMfa(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(null);
    try {
      const data = await post("/api/auth/mfa/verify-login", { challengeToken, code: mfaCode });
      window.location.href = continuation || data?.redirectTo || "/admin/dashboard";
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Codul nu este valid."); }
    finally { setLoading(false); }
  }

  async function submitEnrollment(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(null);
    try {
      if (!enrollment) { await beginRequiredEnrollment(enrollmentToken); return; }
      const data = await post("/api/auth/mfa/confirm-required", { enrollmentToken, code: mfaCode });
      setRecoveryCodes(data.recoveryCodes || []); setRedirectTo(continuation || data.redirectTo || "/admin/dashboard");
      setEnrollment(null); setEnrollmentToken(""); setMfaCode(""); setStep("recovery");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Configurarea nu a reușit."); }
    finally { setLoading(false); }
  }

  async function requestReset(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(null); setMessage(null);
    try {
      const data = await post("/api/auth/password-reset/request", { email });
      setMessage(data?.message || "Verifică emailul pentru instrucțiuni.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Cererea nu a putut fi trimisă."); }
    finally { setLoading(false); }
  }

  function resetStep() {
    setStep("credentials"); setError(null); setMessage(null); setPassword(""); setMfaCode("");
    setChallengeToken(""); setEnrollmentToken(""); setEnrollment(null); setRecoveryCodes([]);
  }

  async function copyCodes() {
    try { await navigator.clipboard.writeText(recoveryCodes.join("\n")); setMessage("Codurile au fost copiate. Păstrează-le într-un loc sigur."); }
    catch { setError("Copierea automată nu este disponibilă. Selectează și salvează codurile manual."); }
  }

  const heading = step === "mfa" ? "Verificare MFA" : step === "enrollment" ? "Configurează MFA" : step === "recovery" ? "Coduri de recuperare" : step === "reset" ? "Resetare parola" : "Autentificare";
  return (
    <form
      onSubmit={step === "mfa" ? submitMfa : step === "enrollment" ? submitEnrollment : step === "reset" ? requestReset : step === "recovery" ? (event) => { event.preventDefault(); window.location.href = redirectTo; } : submitCredentials}
      className="focus-card mx-auto grid w-full max-w-md gap-4 rounded-lg p-6"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-focus-yellow text-focus-navy">
          {step === "recovery" ? <ShieldCheck size={24} /> : step === "mfa" || step === "enrollment" ? <KeyRound size={24} /> : step === "reset" ? <Mail size={24} /> : <Lock size={24} />}
        </span>
        <div><p className="text-xs font-black uppercase text-focus-yellow">Focus Media</p><h1 className="font-display text-3xl font-black uppercase">{heading}</h1></div>
      </div>

      {step === "mfa" || step === "enrollment" ? <>
        <p className="text-sm text-slate-300">{step === "mfa" ? "Introdu codul de 6 cifre din aplicația de autentificare sau un cod de recuperare." : "Acest cont necesită autentificare în doi pași. Accesul în aplicație se acordă după verificarea codului."}</p>
        {step === "enrollment" && enrollment ? <>
          <p className="text-sm text-slate-300">Adaugă manual cheia într-o aplicație TOTP compatibilă.</p>
          <code className="break-all rounded-lg border border-focus-line p-3 text-sm">{enrollment.secret}</code>
          <a className="focus-button secondary" href={enrollment.uri}><Link2 size={17} />Deschide aplicația TOTP</a>
        </> : null}
        {step === "mfa" || enrollment ? <label className="grid gap-2"><span className="text-sm font-bold">Cod MFA</span><input className="focus-input" inputMode={step === "enrollment" ? "numeric" : "text"} autoComplete="one-time-code" value={mfaCode} maxLength={128} onChange={(event) => setMfaCode(event.target.value)} required autoFocus /></label> : null}
      </> : step === "recovery" ? <>
        <p className="text-sm text-slate-300">MFA este activ. Aceste coduri sunt afișate o singură dată. Fiecare cod permite o singură autentificare dacă pierzi accesul la aplicația TOTP.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border border-focus-line p-3 font-mono text-sm" aria-label="Coduri de recuperare MFA">{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
        <button className="focus-button secondary" type="button" onClick={copyCodes}><Copy size={17} />Copiază codurile</button>
      </> : <label className="grid gap-2"><span className="text-sm font-bold">Email</span><input className="focus-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>}

      {step === "credentials" ? <label className="grid gap-2"><span className="text-sm font-bold">Parola</span><input className="focus-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label> : null}
      {message ? <p role="status" className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">{message}</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-100">{error}</p> : null}
      <button className="focus-button" type="submit" disabled={loading}>
        {step === "reset" ? <Mail size={18} /> : step === "mfa" || step === "enrollment" ? <KeyRound size={18} /> : <LogIn size={18} />}
        {loading ? "Se verifică..." : step === "reset" ? "Trimite instrucțiunile" : step === "mfa" ? "Confirmă codul" : step === "enrollment" ? enrollment ? "Activează MFA" : "Reîncepe configurarea" : step === "recovery" ? "Am salvat codurile. Continuă" : "Login"}
      </button>
      {step !== "credentials" && step !== "recovery" ? <button className="focus-button secondary" type="button" disabled={loading} onClick={resetStep}><ArrowLeft size={18} />Înapoi la login</button> : step === "credentials" && passwordResetAvailable ? <button className="text-sm font-bold text-slate-300 underline-offset-4 hover:text-white hover:underline" type="button" onClick={() => { setStep("reset"); setError(null); }}>Ai uitat parola?</button> : null}
    </form>
  );
}
