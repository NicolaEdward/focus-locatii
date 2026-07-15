"use client";

import { Fragment, useState } from "react";
import { Check, KeyRound, Plus, ShieldCheck, UserRoundX, X } from "lucide-react";
import type { UserDTO } from "@/lib/users";
import { ROLE_LABELS, USER_ROLES, type UserRole } from "@/lib/rbac";

const emptyForm = { name: "", email: "", password: "", role: "SALES_AGENT" as UserRole };

export function UserManagement({ initialUsers, currentUserId }: { initialUsers: UserDTO[]; currentUserId: string }) {
  const [users, setUsers] = useState(initialUsers);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirmation, setResetPasswordConfirmation] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setMessage(null);
    const response = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const data = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) return setMessage({ tone: "error", text: data?.error || "Contul nu a putut fi creat." });
    setUsers((current) => [...current, data.user].sort((a, b) => a.name.localeCompare(b.name, "ro")));
    setForm(emptyForm); setMessage({ tone: "ok", text: "Contul a fost creat." });
  }

  async function update(id: string, patch: Partial<UserDTO> & { password?: string }) {
    setMessage(null);
    const response = await fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const data = await response.json().catch(() => null);
    if (!response.ok) return setMessage({ tone: "error", text: data?.error || "Contul nu a putut fi actualizat." });
    setUsers((current) => current.map((user) => user.id === id ? data.user : user));
    setMessage({ tone: "ok", text: "Modificarile au fost salvate." });
  }

  async function submitPasswordReset(event: React.FormEvent, id: string) {
    event.preventDefault();
    setMessage(null);
    if (resetPassword.length < 12) {
      return setMessage({ tone: "error", text: "Parola temporara trebuie sa aiba minimum 12 caractere." });
    }
    if (resetPassword !== resetPasswordConfirmation) {
      return setMessage({ tone: "error", text: "Confirmarea parolei nu corespunde." });
    }

    setResetBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${id}/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: resetPassword })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        return setMessage({ tone: "error", text: data?.error || "Parola nu a putut fi resetata." });
      }
      setUsers((current) => current.map((user) => user.id === id ? data.user : user));
      closePasswordReset();
      setMessage({ tone: "ok", text: "Parola a fost resetata, iar sesiunile vechi au fost revocate." });
    } catch {
      setMessage({ tone: "error", text: "Conexiunea a fost intrerupta. Parola nu a fost resetata." });
    } finally {
      setResetBusy(false);
    }
  }

  function openPasswordReset(id: string) {
    setResettingUserId(id);
    setResetPassword("");
    setResetPasswordConfirmation("");
    setMessage(null);
  }

  function closePasswordReset() {
    setResettingUserId(null);
    setResetPassword("");
    setResetPasswordConfirmation("");
  }

  return <main className="focus-shell py-8"><div className="focus-container grid gap-6">
    <section className="border-b border-focus-line pb-5"><p className="text-xs font-black uppercase text-focus-yellow">Administrare acces</p><h1 className="font-display text-4xl font-black uppercase">Utilizatori si roluri</h1><p className="mt-2 text-sm text-slate-400">Conturi individuale, permisiuni centralizate si sesiuni revocabile.</p></section>
    {message ? <p className={`rounded-lg border p-3 text-sm ${message.tone === "ok" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100" : "border-red-400/40 bg-red-400/10 text-red-100"}`}>{message.text}</p> : null}
    <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <form className="grid content-start gap-4 rounded-lg border border-focus-line bg-focus-ink/70 p-5" onSubmit={create}>
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-focus-yellow text-focus-navy"><Plus size={20} /></span><div><h2 className="font-black uppercase">Cont nou</h2><p className="text-xs text-slate-400">Parola initiala are minimum 12 caractere.</p></div></div>
        <Field label="Nume"><input className="focus-input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
        <Field label="Email"><input className="focus-input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></Field>
        <Field label="Parola initiala"><input className="focus-input" type="password" minLength={12} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></Field>
        <Field label="Rol"><select className="focus-input" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}>{USER_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></Field>
        <button className="focus-button" disabled={saving} type="submit"><Plus size={18} />{saving ? "Se creeaza..." : "Creeaza utilizator"}</button>
      </form>
      <section className="overflow-hidden rounded-lg border border-focus-line bg-focus-ink/70">
        <div className="border-b border-focus-line px-5 py-4">
          <h2 className="text-sm font-black uppercase text-focus-yellow">Conturi ({users.length})</h2>
          <p className="mt-1 text-xs text-slate-400">Conturile cu istoric se dezactiveaza, nu se sterg. Astfel, rezervarile si auditul raman corecte.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-focus-navy/70 text-left text-xs uppercase text-slate-400">
              <tr><th className="px-4 py-3">Utilizator</th><th className="px-4 py-3">Rol</th><th className="px-4 py-3">Ultima autentificare</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actiuni</th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <Fragment key={user.id}>
                  <tr className="border-t border-focus-line">
                    <td className="px-4 py-3"><strong>{user.name}</strong><span className="block text-xs text-slate-400">{user.email}{user.id === currentUserId ? " / contul tau" : ""}</span></td>
                    <td className="px-4 py-3"><select className="focus-input" value={user.role} onChange={(event) => update(user.id, { role: event.target.value as UserRole })}>{USER_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></td>
                    <td className="px-4 py-3 text-slate-400">{user.lastLoginAt ? formatDate(user.lastLoginAt) : "Niciodata"}</td>
                    <td className="px-4 py-3"><span className={`inline-flex items-center gap-2 font-bold ${user.active ? "text-emerald-300" : "text-slate-500"}`}>{user.active ? <Check size={16} /> : <UserRoundX size={16} />}{user.active ? "Activ" : "Inactiv"}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button className="focus-button secondary" disabled={user.id === currentUserId} type="button" onClick={() => openPasswordReset(user.id)}><KeyRound size={16} />Reseteaza parola</button>
                        <button className="focus-button secondary" disabled={user.id === currentUserId} type="button" onClick={() => update(user.id, { active: !user.active })}><ShieldCheck size={16} />{user.active ? "Dezactiveaza" : "Activeaza"}</button>
                      </div>
                    </td>
                  </tr>
                  {resettingUserId === user.id ? (
                    <tr className="border-t border-focus-line bg-focus-navy/45">
                      <td className="px-4 py-4" colSpan={5}>
                        <form className="grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end" onSubmit={(event) => submitPasswordReset(event, user.id)}>
                          <Field label="Parola temporara"><input className="focus-input" type="password" minLength={12} maxLength={128} autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required /></Field>
                          <Field label="Confirma parola"><input className="focus-input" type="password" minLength={12} maxLength={128} autoComplete="new-password" value={resetPasswordConfirmation} onChange={(event) => setResetPasswordConfirmation(event.target.value)} required /></Field>
                          <div className="flex gap-2">
                            <button className="focus-button" disabled={resetBusy} type="submit"><KeyRound size={16} />{resetBusy ? "Se reseteaza..." : "Confirma resetarea"}</button>
                            <button className="focus-button secondary" disabled={resetBusy} type="button" onClick={closePasswordReset} aria-label="Inchide resetarea parolei"><X size={16} /></button>
                          </div>
                        </form>
                        <p className="mt-2 text-xs text-slate-400">Resetarea revoca toate sesiunile active ale utilizatorului. Parola nu este salvata in audit.</p>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  </div></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-2"><span className="text-sm font-bold">{label}</span>{children}</label>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
