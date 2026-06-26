"use client";

import { useState } from "react";
import { Lock, LogIn } from "lucide-react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    setLoading(false);

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error || "Login failed.");
      return;
    }

    const data = await response.json().catch(() => null);
    window.location.href = data?.redirectTo || "/admin/dashboard";
  }

  return (
    <form onSubmit={submit} className="focus-card mx-auto grid w-full max-w-md gap-4 rounded-lg p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-lg bg-focus-yellow text-focus-navy">
          <Lock size={24} />
        </span>
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Focus Media</p>
          <h1 className="font-display text-3xl font-black uppercase">Autentificare</h1>
        </div>
      </div>
      <label className="grid gap-2">
        <span className="text-sm font-bold">Email</span>
        <input className="focus-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-bold">Parola</span>
        <input
          className="focus-input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error ? <p className="rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-100">{error}</p> : null}
      <button className="focus-button" type="submit" disabled={loading}>
        <LogIn size={18} />
        {loading ? "Se verifica..." : "Login"}
      </button>
    </form>
  );
}
