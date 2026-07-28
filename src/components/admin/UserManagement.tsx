"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Check,
  ChevronRight,
  CircleUserRound,
  History,
  KeyRound,
  MailPlus,
  Search,
  ShieldCheck,
  ShieldMinus,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
  Users,
  X
} from "lucide-react";
import type { UserAuditEventDTO, UserDTO } from "@/lib/users";
import {
  ROLE_LABELS,
  USER_ROLES,
  type RoleDefinition,
  type UserRole
} from "@/lib/rbac";

type Props = {
  initialUsers: UserDTO[];
  currentUserId: string;
  invitesAvailable: boolean;
  readOnly?: boolean;
  roles: readonly RoleDefinition[];
};

type CreateMode = "invite" | "direct";
type PendingAccessChange =
  | { type: "role"; user: UserDTO; role: UserRole }
  | { type: "status"; user: UserDTO; active: boolean };

const emptyCreateForm = {
  name: "",
  email: "",
  role: "SALES_AGENT" as UserRole,
  password: "",
  passwordConfirmation: "",
  reason: ""
};

export function UserManagement({
  initialUsers,
  currentUserId,
  invitesAvailable,
  readOnly = false,
  roles
}: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [view, setView] = useState<"accounts" | "permissions">("accounts");
  const [createMode, setCreateMode] = useState<CreateMode | null>(null);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [selectedRole, setSelectedRole] = useState<UserRole>("SUPER_ADMIN");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingChange, setPendingChange] = useState<PendingAccessChange | null>(null);
  const [changeReason, setChangeReason] = useState("");
  const [resettingUser, setResettingUser] = useState<UserDTO | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirmation, setResetPasswordConfirmation] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [mfaResetUser, setMfaResetUser] = useState<UserDTO | null>(null);
  const [auditUser, setAuditUser] = useState<UserDTO | null>(null);
  const [auditEvents, setAuditEvents] = useState<UserAuditEventDTO[]>([]);
  const [auditBusy, setAuditBusy] = useState(false);
  const [testInviteLink, setTestInviteLink] = useState<string | null>(null);

  const visibleUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ro-RO");
    return users.filter((user) => {
      if (statusFilter === "active" && !user.active) return false;
      if (statusFilter === "inactive" && user.active) return false;
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      return !normalized || `${user.name} ${user.email} ${ROLE_LABELS[user.role]}`.toLocaleLowerCase("ro-RO").includes(normalized);
    });
  }, [query, roleFilter, statusFilter, users]);

  const stats = useMemo(() => ({
    active: users.filter((user) => user.active).length,
    inactive: users.filter((user) => !user.active).length,
    mfa: users.filter((user) => user.mfaEnabled).length,
    neverLoggedIn: users.filter((user) => !user.lastLoginAt).length
  }), [users]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPendingChange(null);
      setResettingUser(null);
      setMfaResetUser(null);
      setAuditUser(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!createMode) return;
    setSaving(true);
    setMessage(null);
    setTestInviteLink(null);

    if (createMode === "direct" && createForm.password !== createForm.passwordConfirmation) {
      setSaving(false);
      setMessage({ tone: "error", text: "Confirmarea parolei nu corespunde." });
      return;
    }

    const endpoint = createMode === "invite" ? "/api/admin/users/invite" : "/api/admin/users";
    const payload = createMode === "invite"
      ? { name: createForm.name, email: createForm.email, role: createForm.role }
      : {
          name: createForm.name,
          email: createForm.email,
          role: createForm.role,
          password: createForm.password,
          reason: createForm.reason
        };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ tone: "error", text: data?.error || "Contul nu a putut fi pregatit." });
        return;
      }
      if (data?.user) {
        setUsers((current) => sortUsers([data.user, ...current]));
      }
      setTestInviteLink(data?.testInviteLink || null);
      setCreateForm(emptyCreateForm);
      setCreateMode(null);
      setMessage({
        tone: "ok",
        text: createMode === "invite"
          ? "Invitatia a fost pregatita si este valabila 72 de ore."
          : "Contul activ a fost creat. Utilizatorul se poate autentifica imediat."
      });
    } catch {
      setMessage({ tone: "error", text: "Conexiunea a fost intrerupta. Contul nu a fost modificat." });
    } finally {
      setSaving(false);
    }
  }

  async function confirmAccessChange(event: React.FormEvent) {
    event.preventDefault();
    if (!pendingChange || changeReason.trim().length < 3) return;
    const patch = pendingChange.type === "role"
      ? { role: pendingChange.role, reason: changeReason.trim() }
      : { active: pendingChange.active, reason: changeReason.trim() };
    const changed = await updateUser(pendingChange.user.id, patch);
    if (changed) {
      setPendingChange(null);
      setChangeReason("");
    }
  }

  async function updateUser(id: string, patch: Record<string, unknown>) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ tone: "error", text: data?.error || "Contul nu a putut fi actualizat." });
        return false;
      }
      setUsers((current) => sortUsers(current.map((user) => user.id === id ? data.user : user)));
      setMessage({ tone: "ok", text: "Accesul utilizatorului a fost actualizat si auditat." });
      return true;
    } catch {
      setMessage({ tone: "error", text: "Conexiunea a fost intrerupta. Contul nu a fost modificat." });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submitPasswordReset(event: React.FormEvent) {
    event.preventDefault();
    if (!resettingUser) return;
    setMessage(null);
    if (resetPassword.length < 12) {
      setMessage({ tone: "error", text: "Parola temporara trebuie sa aiba minimum 12 caractere." });
      return;
    }
    if (resetPassword !== resetPasswordConfirmation) {
      setMessage({ tone: "error", text: "Confirmarea parolei nu corespunde." });
      return;
    }

    setResetBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${resettingUser.id}/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: resetPassword })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ tone: "error", text: data?.error || "Parola nu a putut fi resetata." });
        return;
      }
      setUsers((current) => current.map((user) => user.id === resettingUser.id ? data.user : user));
      closePasswordReset();
      setMessage({ tone: "ok", text: "Parola a fost resetata, iar sesiunile vechi au fost revocate." });
    } catch {
      setMessage({ tone: "error", text: "Conexiunea a fost intrerupta. Parola nu a fost resetata." });
    } finally {
      setResetBusy(false);
    }
  }

  async function resetMfa() {
    if (!mfaResetUser) return;
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${mfaResetUser.id}/reset-mfa`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ tone: "error", text: data?.error || "MFA nu a putut fi resetat." });
        return;
      }
      setUsers((current) => current.map((item) => item.id === mfaResetUser.id ? { ...item, mfaEnabled: false } : item));
      setMfaResetUser(null);
      setMessage({
        tone: "ok",
        text: data?.credentialRemoved
          ? "MFA a fost resetat, iar sesiunile au fost revocate."
          : "Contul nu avea MFA activ. Sesiunile au fost revocate preventiv."
      });
    } catch {
      setMessage({ tone: "error", text: "Conexiunea a fost intrerupta. MFA nu a fost modificat." });
    }
  }

  async function openAudit(user: UserDTO) {
    setAuditUser(user);
    setAuditEvents([]);
    setAuditBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/audit`);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ tone: "error", text: data?.error || "Istoricul nu a putut fi incarcat." });
        setAuditUser(null);
        return;
      }
      setAuditEvents(data?.events || []);
    } catch {
      setMessage({ tone: "error", text: "Conexiunea a fost intrerupta. Istoricul nu a fost incarcat." });
      setAuditUser(null);
    } finally {
      setAuditBusy(false);
    }
  }

  function closePasswordReset() {
    setResettingUser(null);
    setResetPassword("");
    setResetPasswordConfirmation("");
  }

  return (
    <main className="focus-shell py-6 lg:py-8">
      <div className="focus-container grid gap-5">
        <header className="flex flex-col gap-4 border-b border-focus-line pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Administrare acces</p>
            <h1 className="font-display text-3xl font-black uppercase sm:text-4xl">Utilizatori si permisiuni</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Interfata canonica pentru conturi, roluri, autentificare si audit. Conturile cu istoric se dezactiveaza si nu se sterg.
            </p>
          </div>
          {!readOnly ? (
            <div className="flex flex-wrap gap-2">
              <button className="focus-button secondary" disabled={!invitesAvailable} type="button" onClick={() => setCreateMode("invite")}>
                <MailPlus size={18} /> Invita
              </button>
              <button className="focus-button" type="button" onClick={() => setCreateMode("direct")}>
                <UserPlus size={18} /> Creeaza cont
              </button>
            </div>
          ) : null}
        </header>

        {message ? (
          <p role="status" className={`rounded-lg border p-3 text-sm ${message.tone === "ok" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100" : "border-red-400/40 bg-red-400/10 text-red-100"}`}>
            {message.text}
          </p>
        ) : null}

        {testInviteLink ? (
          <p className="rounded-lg border border-focus-yellow/40 bg-focus-yellow/10 p-3 text-sm">
            Link sintetic Preview: <a className="break-all font-bold text-focus-yellow underline" href={testInviteLink}>deschide invitatia</a>
          </p>
        ) : null}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Conturi active" value={stats.active} icon={<UserRoundCheck size={19} />} tone="good" />
          <Stat label="Conturi inactive" value={stats.inactive} icon={<UserRoundX size={19} />} />
          <Stat label="MFA activ" value={stats.mfa} icon={<ShieldCheck size={19} />} tone="good" />
          <Stat label="Fara autentificare" value={stats.neverLoggedIn} icon={<Activity size={19} />} tone={stats.neverLoggedIn > 0 ? "warn" : "good"} />
        </section>

        <nav aria-label="Sectiuni administrare utilizatori" className="flex gap-2 border-b border-focus-line">
          <Tab active={view === "accounts"} onClick={() => setView("accounts")} icon={<Users size={17} />}>Conturi</Tab>
          <Tab active={view === "permissions"} onClick={() => setView("permissions")} icon={<ShieldCheck size={17} />}>Roluri si permisiuni</Tab>
        </nav>

        {view === "accounts" ? (
          <section className="grid gap-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_220px_220px]">
              <label className="relative">
                <span className="sr-only">Cauta utilizator</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input className="focus-input pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cauta dupa nume, email sau rol" />
              </label>
              <label>
                <span className="sr-only">Filtreaza dupa status</span>
                <select className="focus-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                  <option value="all">Toate statusurile</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label>
                <span className="sr-only">Filtreaza dupa rol</span>
                <select className="focus-input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}>
                  <option value="all">Toate rolurile</option>
                  {USER_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                </select>
              </label>
            </div>

            <div className="overflow-hidden rounded-lg border border-focus-line bg-focus-ink/70">
              <div className="flex items-center justify-between border-b border-focus-line px-4 py-3">
                <div>
                  <h2 className="text-sm font-black uppercase text-focus-yellow">Conturi ({visibleUsers.length})</h2>
                  <p className="mt-1 text-xs text-slate-400">{readOnly ? "Vizualizare read-only." : "Modificarile de rol si status necesita confirmare si motiv."}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className={`w-full ${readOnly ? "min-w-[760px]" : "min-w-[1180px]"} text-sm`}>
                  <thead className="bg-focus-navy/70 text-left text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Utilizator</th>
                      <th className="px-4 py-3">Acces</th>
                      <th className="px-4 py-3">Securitate</th>
                      <th className="px-4 py-3">Ultima autentificare</th>
                      <th className="px-4 py-3">Status</th>
                      {!readOnly ? <th className="px-4 py-3">Actiuni</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUsers.map((user) => {
                      const role = roles.find((item) => item.id === user.role);
                      const self = user.id === currentUserId;
                      return (
                        <tr key={user.id} className="border-t border-focus-line align-top">
                          <td className="px-4 py-4">
                            <strong>{user.name}</strong>
                            <span className="block text-xs text-slate-400">{user.email}</span>
                            {self ? <span className="mt-1 inline-flex rounded border border-focus-yellow/40 px-1.5 py-0.5 text-[10px] font-black uppercase text-focus-yellow">Contul tau</span> : null}
                          </td>
                          <td className="px-4 py-4">
                            {readOnly || self ? (
                              <span className="font-bold text-slate-200">{ROLE_LABELS[user.role]}</span>
                            ) : (
                              <select
                                aria-label={`Rol pentru ${user.name}`}
                                className="focus-input w-[210px] min-w-[210px]"
                                value={user.role}
                                onChange={(event) => {
                                  setPendingChange({ type: "role", user, role: event.target.value as UserRole });
                                  setChangeReason("");
                                }}
                              >
                                {USER_ROLES.map((item) => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
                              </select>
                            )}
                            <button className="mt-1 block min-h-8 text-left text-xs text-slate-400 underline decoration-slate-600 underline-offset-2" type="button" onClick={() => { setSelectedRole(user.role); setView("permissions"); }}>
                              {role?.permissions.length || 0} permisiuni efective
                            </button>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center gap-2 font-bold ${user.mfaEnabled ? "text-emerald-300" : "text-amber-200"}`}>
                              {user.mfaEnabled ? <ShieldCheck size={16} /> : <ShieldMinus size={16} />}
                              {user.mfaEnabled ? "MFA activ" : "MFA inactiv"}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-slate-400">{user.lastLoginAt ? formatDate(user.lastLoginAt) : "Niciodata"}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center gap-2 font-bold ${user.active ? "text-emerald-300" : "text-slate-500"}`}>
                              {user.active ? <Check size={16} /> : <UserRoundX size={16} />}
                              {user.active ? "Activ" : "Inactiv"}
                            </span>
                          </td>
                          {!readOnly ? (
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                <IconAction label={`Istoric acces pentru ${user.name}`} onClick={() => openAudit(user)}><History size={16} /></IconAction>
                                <IconAction label={`Reseteaza parola pentru ${user.name}`} disabled={self} onClick={() => setResettingUser(user)}><KeyRound size={16} /></IconAction>
                                <IconAction label={`Reseteaza MFA pentru ${user.name}`} disabled={self} onClick={() => setMfaResetUser(user)}><ShieldCheck size={16} /></IconAction>
                                <button
                                  className="focus-button secondary min-h-9"
                                  disabled={self}
                                  type="button"
                                  onClick={() => {
                                    setPendingChange({ type: "status", user, active: !user.active });
                                    setChangeReason("");
                                  }}
                                >
                                  {user.active ? <UserRoundX size={16} /> : <UserRoundCheck size={16} />}
                                  {user.active ? "Dezactiveaza" : "Activeaza"}
                                </button>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {visibleUsers.length === 0 ? (
                <div className="grid min-h-40 place-items-center p-6 text-center">
                  <div><CircleUserRound className="mx-auto text-slate-600" size={32} /><p className="mt-2 font-bold">Niciun cont nu corespunde filtrelor.</p><p className="text-sm text-slate-400">Schimba termenul de cautare sau filtrele.</p></div>
                </div>
              ) : null}
            </div>
          </section>
        ) : (
          <PermissionsView roles={roles} selectedRole={selectedRole} onSelectRole={setSelectedRole} />
        )}
      </div>

      {createMode ? (
        <Modal title={createMode === "invite" ? "Invita utilizator" : "Creeaza cont activ"} onClose={() => setCreateMode(null)}>
          <form className="grid gap-4" onSubmit={submitCreate}>
            <p className="text-sm text-slate-400">
              {createMode === "invite"
                ? "Utilizatorul primeste un link valabil 72 de ore si isi seteaza singur parola."
                : "Contul devine activ imediat. Comunica parola temporara printr-un canal sigur."}
            </p>
            <Field label="Nume"><input className="focus-input" value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} required /></Field>
            <Field label="Email"><input className="focus-input" type="email" value={createForm.email} onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} required /></Field>
            <Field label="Rol"><select className="focus-input" value={createForm.role} onChange={(event) => setCreateForm({ ...createForm, role: event.target.value as UserRole })}>{USER_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></Field>
            {createMode === "direct" ? (
              <>
                <Field label="Parola temporara"><input className="focus-input" type="password" minLength={12} maxLength={128} autoComplete="new-password" value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} required /></Field>
                <Field label="Confirma parola"><input className="focus-input" type="password" minLength={12} maxLength={128} autoComplete="new-password" value={createForm.passwordConfirmation} onChange={(event) => setCreateForm({ ...createForm, passwordConfirmation: event.target.value })} required /></Field>
                <Field label="Motiv"><textarea className="focus-input min-h-20" minLength={3} maxLength={500} value={createForm.reason} onChange={(event) => setCreateForm({ ...createForm, reason: event.target.value })} placeholder="De ce este creat acest acces?" required /></Field>
              </>
            ) : null}
            <div className="flex justify-end gap-2">
              <button className="focus-button secondary" type="button" onClick={() => setCreateMode(null)}>Renunta</button>
              <button className="focus-button" disabled={saving || (createMode === "invite" && !invitesAvailable)} type="submit">
                {createMode === "invite" ? <MailPlus size={18} /> : <UserPlus size={18} />}
                {saving ? "Se salveaza..." : createMode === "invite" ? "Trimite invitatia" : "Creeaza contul"}
              </button>
            </div>
            {createMode === "invite" && !invitesAvailable ? <p className="text-sm text-amber-200">Serviciul de email nu este configurat. Foloseste crearea directa a contului.</p> : null}
          </form>
        </Modal>
      ) : null}

      {pendingChange ? (
        <Modal title={pendingChange.type === "role" ? "Confirma schimbarea rolului" : pendingChange.active ? "Confirma activarea" : "Confirma dezactivarea"} onClose={() => setPendingChange(null)}>
          <form className="grid gap-4" onSubmit={confirmAccessChange}>
            <div className="rounded-lg border border-focus-line bg-focus-navy/50 p-4 text-sm">
              <p className="font-bold">{pendingChange.user.name}</p>
              {pendingChange.type === "role" ? (
                <p className="mt-1 text-slate-300">{ROLE_LABELS[pendingChange.user.role]} <ChevronRight className="inline" size={16} /> {ROLE_LABELS[pendingChange.role]}</p>
              ) : (
                <p className="mt-1 text-slate-300">{pendingChange.user.active ? "Activ" : "Inactiv"} <ChevronRight className="inline" size={16} /> {pendingChange.active ? "Activ" : "Inactiv"}</p>
              )}
            </div>
            {!pendingChange.user.active && pendingChange.type === "role" ? <p className="text-sm text-amber-200">Contul ramane inactiv dupa schimbarea rolului.</p> : null}
            <Field label="Motivul modificarii"><textarea autoFocus className="focus-input min-h-24" minLength={3} maxLength={500} value={changeReason} onChange={(event) => setChangeReason(event.target.value)} placeholder="Motivul va fi pastrat in audit." required /></Field>
            <div className="flex justify-end gap-2">
              <button className="focus-button secondary" type="button" onClick={() => setPendingChange(null)}>Renunta</button>
              <button className="focus-button" disabled={saving || changeReason.trim().length < 3} type="submit"><ShieldCheck size={18} /> Confirma</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {resettingUser ? (
        <Modal title={`Reseteaza parola - ${resettingUser.name}`} onClose={closePasswordReset}>
          <form className="grid gap-4" onSubmit={submitPasswordReset}>
            <p className="text-sm text-slate-400">Resetarea invalideaza sesiunile existente. Parola nu este inclusa in audit.</p>
            <Field label="Parola temporara"><input autoFocus className="focus-input" type="password" minLength={12} maxLength={128} autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required /></Field>
            <Field label="Confirma parola"><input className="focus-input" type="password" minLength={12} maxLength={128} autoComplete="new-password" value={resetPasswordConfirmation} onChange={(event) => setResetPasswordConfirmation(event.target.value)} required /></Field>
            <div className="flex justify-end gap-2">
              <button className="focus-button secondary" disabled={resetBusy} type="button" onClick={closePasswordReset}>Renunta</button>
              <button className="focus-button" disabled={resetBusy} type="submit"><KeyRound size={18} /> {resetBusy ? "Se reseteaza..." : "Reseteaza parola"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {mfaResetUser ? (
        <Modal title={`Reseteaza MFA - ${mfaResetUser.name}`} onClose={() => setMfaResetUser(null)}>
          <div className="grid gap-4">
            <p className="text-sm text-slate-300">Credentialul MFA si codurile de recuperare vor fi invalidate. Toate sesiunile active ale utilizatorului vor fi revocate.</p>
            <p className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">Utilizatorul va trebui sa configureze din nou MFA la urmatoarea autentificare, conform politicii rolului.</p>
            <div className="flex justify-end gap-2">
              <button className="focus-button secondary" type="button" onClick={() => setMfaResetUser(null)}>Renunta</button>
              <button className="focus-button" type="button" onClick={resetMfa}><ShieldCheck size={18} /> Reseteaza MFA</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {auditUser ? (
        <Modal title={`Istoric acces - ${auditUser.name}`} onClose={() => setAuditUser(null)} wide>
          {auditBusy ? <p className="py-8 text-center text-sm text-slate-400">Se incarca istoricul...</p> : null}
          {!auditBusy && auditEvents.length === 0 ? <p className="rounded-lg border border-focus-line p-4 text-sm text-slate-400">Nu exista evenimente de acces inregistrate pentru acest cont.</p> : null}
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
            {auditEvents.map((event) => (
              <article key={event.id} className="border-b border-focus-line pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="font-bold">{auditActionLabel(event.action)}</p><p className="text-xs text-slate-400">de {event.actorLabel}</p></div>
                  <time className="text-xs text-slate-400">{formatDate(event.createdAt)}</time>
                </div>
                {event.before || event.after ? <p className="mt-2 text-sm text-slate-300">{accessStateLabel(event.before)} <ChevronRight className="inline" size={14} /> {accessStateLabel(event.after)}</p> : null}
                {event.reason ? <p className="mt-1 text-sm text-slate-400">Motiv: {event.reason}</p> : null}
                {event.sessionsRevoked ? <p className="mt-1 text-xs font-bold text-amber-200">Sesiunile au fost revocate.</p> : null}
              </article>
            ))}
          </div>
        </Modal>
      ) : null}
    </main>
  );
}

function PermissionsView({
  roles,
  selectedRole,
  onSelectRole
}: {
  roles: readonly RoleDefinition[];
  selectedRole: UserRole;
  onSelectRole: (role: UserRole) => void;
}) {
  const role = roles.find((item) => item.id === selectedRole) || roles[0];
  const categories = [...new Set(role.permissions.map((permission) => permission.category))];
  return (
    <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="grid content-start gap-2">
        {roles.map((item) => (
          <button key={item.id} className={`min-h-12 border px-4 py-3 text-left ${item.id === role.id ? "border-focus-yellow bg-focus-yellow/10" : "border-focus-line bg-focus-ink/60 hover:border-slate-500"}`} type="button" onClick={() => onSelectRole(item.id)}>
            <span className="block font-black">{item.label}</span>
            <span className="text-xs text-slate-400">{item.permissions.length} permisiuni</span>
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-focus-line bg-focus-ink/70 p-5">
        <div className="border-b border-focus-line pb-4">
          <p className="text-xs font-black uppercase text-focus-yellow">Politica efectiva</p>
          <h2 className="mt-1 text-2xl font-black">{role.label}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">{role.description}</p>
          <p className="mt-3 text-xs text-slate-500">Permisiunile sunt aplicate exclusiv server-side. Schimbarea rolului unui cont actualizeaza automat aceasta politica.</p>
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          {categories.map((category) => (
            <section key={category}>
              <h3 className="mb-2 text-xs font-black uppercase text-focus-yellow">{category}</h3>
              <div className="grid gap-2">
                {role.permissions.filter((permission) => permission.category === category).map((permission) => (
                  <div key={permission.id} className="flex items-start justify-between gap-3 border-b border-focus-line/70 py-2">
                    <div><p className="text-sm font-bold">{permission.label}</p><p className="text-xs text-slate-400">{permission.description}</p></div>
                    <span className={`shrink-0 rounded border px-2 py-1 text-[10px] font-black uppercase ${permission.mutating ? "border-amber-300/30 text-amber-200" : "border-emerald-300/30 text-emerald-200"}`}>{permission.mutating ? "Modifica" : "Citire"}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusable = () => panel
      ? [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')]
      : [];
    const initial = panel?.querySelector<HTMLElement>("[autofocus]") || focusable()[0];
    initial?.focus();

    function trapFocus(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      previous?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/75 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} aria-modal="true" aria-label={title} role="dialog" className={`max-h-[92vh] w-full overflow-y-auto rounded-lg border border-focus-line bg-focus-ink p-5 shadow-2xl ${wide ? "max-w-3xl" : "max-w-lg"}`}>
        <header className="mb-5 flex items-center justify-between gap-3 border-b border-focus-line pb-3">
          <h2 className="text-xl font-black uppercase">{title}</h2>
          <button className="grid h-9 w-9 place-items-center rounded border border-focus-line hover:border-focus-yellow" type="button" onClick={onClose} aria-label="Inchide"><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2"><span className="text-sm font-bold">{label}</span>{children}</label>;
}

function Tab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button className={`flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-black uppercase ${active ? "border-focus-yellow text-focus-yellow" : "border-transparent text-slate-400 hover:text-white"}`} type="button" onClick={onClick}>{icon}{children}</button>;
}

function IconAction({ label, disabled = false, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className="grid h-9 w-9 place-items-center rounded border border-focus-line text-slate-300 hover:border-focus-yellow hover:text-focus-yellow disabled:cursor-not-allowed disabled:opacity-35" aria-label={label} title={label} disabled={disabled} type="button" onClick={onClick}>{children}</button>;
}

function Stat({ label, value, icon, tone = "neutral" }: { label: string; value: number; icon: React.ReactNode; tone?: "neutral" | "good" | "warn" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-200" : "text-slate-300";
  return <div className="border-b border-focus-line bg-focus-ink/45 px-4 py-3"><div className={`flex items-center gap-2 text-xs font-black uppercase ${color}`}>{icon}{label}</div><p className="mt-1 text-2xl font-black">{value}</p></div>;
}

function sortUsers(users: UserDTO[]) {
  return [...users].sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name, "ro"));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    "user.create": "Cont creat",
    "user.activate": "Cont activat",
    "user.deactivate": "Cont dezactivat",
    "user.role.change": "Rol schimbat",
    "user.profile.update": "Profil actualizat",
    "user.password.reset": "Parola resetata",
    "auth.mfa.admin_reset": "MFA resetat",
    "auth.login": "Autentificare",
    "auth.mfa.login": "Autentificare cu MFA",
    "auth.password.reset.complete": "Parola schimbata prin recuperare",
    "auth.invite.accept": "Invitatie acceptata"
  };
  return labels[action] || action;
}

function accessStateLabel(state: UserAuditEventDTO["before"]) {
  if (!state) return "Fara stare";
  const parts = [];
  if (state.role) parts.push(ROLE_LABELS[state.role]);
  if (typeof state.active === "boolean") parts.push(state.active ? "Activ" : "Inactiv");
  return parts.join(" / ") || "Fara stare";
}
