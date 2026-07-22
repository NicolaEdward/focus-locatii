"use client";

import { useState } from "react";
import { ArrowLeft, KeyRound, Lock, LogIn, Mail } from "lucide-react";

type Step = "credentials" | "mfa" | "reset";

export function LoginForm({ passwordResetAvailable }: { passwordResetAvailable: boolean }) {
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) return setError(data?.error || "Autentificarea nu a reusit.");
    if (data?.mfaRequired && data?.challengeToken) {
      setChallengeToken(data.challengeToken);
      setPassword("");
      setStep("mfa");
      return;
    }
    window.location.href = data?.redirectTo || "/admin/dashboard";
  }

  async function submitMfa(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const response = await fetch("/api/auth/mfa/verify-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeToken, code: mfaCode })
    });
    const data = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) return setError(data?.error || "Codul nu este valid.");
    window.location.href = data?.redirectTo || "/admin/dashboard";
  }

  async function requestReset(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    const response = await fetch("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) return setError(data?.error || "Cererea nu a putut fi trimisa.");
    setMessage(data?.message || "Verifica emailul pentru instructiuni.");
  }

  return (
    <form
      onSubmit={step === "mfa" ? submitMfa : step === "reset" ? requestReset : submitCredentials}
      className="focus-card mx-auto grid w-full max-w-md gap-4 rounded-lg p-6"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-lg bg-focus-yellow text-focus-navy">
          {step === "mfa" ? <KeyRound size={24} /> : step === "reset" ? <Mail size={24} /> : <Lock size={24} />}
        </span>
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Focus Media</p>
          <h1 className="font-display text-3xl font-black uppercase">
            {step === "mfa" ? "Verificare MFA" : step === "reset" ? "Resetare parola" : "Autentificare"}
          </h1>
        </div>
      </div>

      {step === "mfa" ? (
        <>
          <p className="text-sm text-slate-300">Introdu codul de 6 cifre din aplicatia de autentificare sau un cod de recuperare.</p>
          <label className="grid gap-2">
            <span className="text-sm font-bold">Cod MFA</span>
            <input className="focus-input" inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} required autoFocus />
          </label>
        </>
      ) : (
        <label className="grid gap-2">
          <span className="text-sm font-bold">Email</span>
          <input className="focus-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
      )}

      {step === "credentials" ? (
        <label className="grid gap-2">
          <span className="text-sm font-bold">Parola</span>
          <input className="focus-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
      ) : null}

      {message ? <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">{message}</p> : null}
      {error ? <p className="rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-100">{error}</p> : null}

      <button className="focus-button" type="submit" disabled={loading}>
        {step === "reset" ? <Mail size={18} /> : step === "mfa" ? <KeyRound size={18} /> : <LogIn size={18} />}
        {loading ? "Se verifica..." : step === "reset" ? "Trimite instructiunile" : step === "mfa" ? "Confirma codul" : "Login"}
      </button>

      {step !== "credentials" ? (
        <button className="focus-button secondary" type="button" disabled={loading} onClick={() => { setStep("credentials"); setError(null); setMessage(null); }}>
          <ArrowLeft size={18} />Inapoi la login
        </button>
      ) : passwordResetAvailable ? (
        <button className="text-sm font-bold text-slate-300 underline-offset-4 hover:text-white hover:underline" type="button" onClick={() => { setStep("reset"); setError(null); }}>
          Ai uitat parola?
        </button>
      ) : null}
    </form>
  );
}
