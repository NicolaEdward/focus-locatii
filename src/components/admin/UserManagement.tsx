"use client";

import { useState } from "react";
import { Check, Plus, ShieldCheck, UserRoundX } from "lucide-react";
import type { UserDTO } from "@/lib/users";
import { ROLE_LABELS, USER_ROLES, type UserRole } from "@/lib/rbac";

const emptyForm = { name: "", email: "", password: "", role: "SALES_AGENT" as UserRole };

export function UserManagement({ initialUsers, currentUserId }: { initialUsers: UserDTO[]; currentUserId: string }) {
  const [users, setUsers] = useState(initialUsers);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

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
        <div className="border-b border-focus-line px-5 py-4"><h2 className="text-sm font-black uppercase text-focus-yellow">Conturi ({users.length})</h2></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-focus-navy/70 text-left text-xs uppercase text-slate-400"><tr><th className="px-4 py-3">Utilizator</th><th className="px-4 py-3">Rol</th><th className="px-4 py-3">Ultima autentificare</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actiune</th></tr></thead><tbody>{users.map((user) => <tr className="border-t border-focus-line" key={user.id}><td className="px-4 py-3"><strong>{user.name}</strong><span className="block text-xs text-slate-400">{user.email}{user.id === currentUserId ? " · contul tau" : ""}</span></td><td className="px-4 py-3"><select className="focus-input" value={user.role} onChange={(event) => update(user.id, { role: event.target.value as UserRole })}>{USER_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></td><td className="px-4 py-3 text-slate-400">{user.lastLoginAt ? formatDate(user.lastLoginAt) : "Niciodata"}</td><td className="px-4 py-3"><span className={`inline-flex items-center gap-2 font-bold ${user.active ? "text-emerald-300" : "text-slate-500"}`}>{user.active ? <Check size={16} /> : <UserRoundX size={16} />}{user.active ? "Activ" : "Inactiv"}</span></td><td className="px-4 py-3"><button className="focus-button secondary" disabled={user.id === currentUserId} type="button" onClick={() => update(user.id, { active: !user.active })}><ShieldCheck size={16} />{user.active ? "Dezactiveaza" : "Activeaza"}</button></td></tr>)}</tbody></table></div>
      </section>
    </section>
  </div></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-2"><span className="text-sm font-bold">{label}</span>{children}</label>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
