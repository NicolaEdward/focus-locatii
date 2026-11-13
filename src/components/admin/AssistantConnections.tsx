"use client";
import { useState } from "react";
type State = {
  enabled: boolean;
  mcpUrl: string;
  issuer: string;
  allowedScopes: string[];
  canManage: boolean;
  clients: {
    id: string;
    name: string;
    redirectUris: string[];
    allowedScopes: string[];
    disabledAt: string | null;
  }[];
  grants: {
    id: string;
    clientId: string;
    scopes: string[];
    offline: boolean;
    expiresAt: string;
    revokedAt: string | null;
  }[];
};
export function AssistantConnections({
  initialState,
}: {
  initialState: State;
}) {
  const [state, setState] = useState(initialState),
    [name, setName] = useState("ChatGPT — conexiune personală"),
    [redirect, setRedirect] = useState(""),
    [scopes, setScopes] = useState<string[]>(["inventory.read"]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [credentials, setCredentials] = useState<{
      id: string;
      clientSecret: string | null;
    } | null>(null);
  async function command(body: unknown) {
    setBusy(true);
    setError("");
    setCredentials(null);
    try {
      const r = await fetch("/api/admin/assistant-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(data.error_description || "Operația nu a reușit.");
      setState(data.state);
      if (data.result.clientSecret !== undefined) setCredentials(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operația nu a reușit.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="focus-container space-y-6 py-6">
      <section className="space-y-4 rounded-2xl border border-focus-line focus-card p-5">
        <h1 data-ui-contrast className="text-2xl font-bold">
          Conexiuni ChatGPT
        </h1>
        <p>
          Verificări OOH personale, numai pentru citire, cu permisiunile
          contului tău. Nu este necesară o cheie OpenAI API. Programarea
          verificărilor se configurează în agentul privat din ChatGPT și trebuie
          probată pe contul tău.
        </p>
        <p role="status">
          {state.enabled
            ? "Endpointul MCP este activ. Autorizarea personală este necesară."
            : "Endpointul MCP este oprit. Configurarea poate fi pregătită; conectarea nu este încă disponibilă."}
        </p>
        <label className="block space-y-1">
          Adresă MCP
          <input className="focus-input w-full" readOnly value={state.mcpUrl} />
        </label>
        <p>
          În ChatGPT deschide „Add custom MCP server” din Plugins sau Apps, în
          funcție de interfața contului. Copiază adresa exactă de revenire
          afișată acolo. Înregistreaz-o mai jos și introdu apoi Client ID și
          secretul în configurarea ChatGPT. Autentifică-te în Focus Media și
          aprobă explicit domeniile solicitate.
        </p>
        <p>
          Accesul în fundal expiră după cel mult 7 zile; reconectarea este
          necesară. Deconectarea/revocarea sesiunii, schimbarea rolului sau
          credențialelor și butoanele de mai jos opresc delegarea. Conectarea
          documentelor NAS se configurează separat; această pagină nu confirmă
          auditarea contractelor reale.
        </p>
      </section>
      {error && (
        <p role="alert" className="rounded-xl border border-red-400 p-4">
          {error}
        </p>
      )}
      {state.canManage && (
        <section className="space-y-4 rounded-2xl border border-focus-line focus-card p-5">
          <h2 className="text-xl font-bold">
            Înregistrează o conexiune aprobată
          </h2>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void command({
                action: "register_client",
                input: {
                  name,
                  redirectUris: [redirect.trim()],
                  scopes,
                  confidential: true,
                },
              });
            }}
          >
            <label>
              Nume
              <input
                className="focus-input mt-1 w-full"
                required
                minLength={3}
                maxLength={160}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Adresa HTTPS exactă de revenire din ChatGPT
              <input
                className="focus-input mt-1 w-full"
                type="url"
                required
                value={redirect}
                onChange={(e) => setRedirect(e.target.value)}
                placeholder="Copiază callback-ul din configurarea ChatGPT"
              />
            </label>
            <fieldset>
              <legend className="mb-2 font-semibold">
                Acces maxim aprobat pentru această conexiune
              </legend>
              <div className="flex flex-wrap gap-4">
                {state.allowedScopes.map((scope) => (
                  <label key={scope} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      onChange={(e) =>
                        setScopes(
                          e.target.checked
                            ? [...scopes, scope]
                            : scopes.filter((s) => s !== scope),
                        )
                      }
                    />
                    {scope}
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              className="focus-button justify-self-start"
              disabled={busy || !scopes.length}
            >
              Înregistrează conexiunea
            </button>
          </form>
          {credentials && (
            <div
              role="status"
              className="space-y-3 rounded-xl border border-focus-yellow p-4"
            >
              <p>
                Păstrează secretul în configurarea privată ChatGPT. Este afișat
                o singură dată și nu va putea fi recuperat.
              </p>
              <label className="block">
                Client ID
                <input
                  className="focus-input mt-1 w-full"
                  readOnly
                  value={credentials.id}
                />
              </label>
              <label className="block">
                Client secret
                <input
                  className="focus-input mt-1 w-full"
                  type="password"
                  autoComplete="off"
                  readOnly
                  value={credentials.clientSecret || ""}
                />
              </label>
              <button
                className="focus-button secondary"
                onClick={() => setCredentials(null)}
              >
                Am salvat credențialele; ascunde
              </button>
            </div>
          )}
        </section>
      )}
      <section className="space-y-4 rounded-2xl border border-focus-line focus-card p-5">
        <h2 className="text-xl font-bold">Delegările mele</h2>
        {!state.grants.length && (
          <p>
            Nu există delegări personale. Înregistrarea unui client nu acordă
            automat acces.
          </p>
        )}
        {state.grants.map((g) => (
          <article
            key={g.id}
            className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border border-focus-line p-4"
          >
            <div className="min-w-0 space-y-2">
              <p className="break-all font-semibold">{g.clientId}</p>
              <p className="break-words text-sm">{g.scopes.join(", ")}</p>
              <p>
                {g.revokedAt
                  ? "Revocată"
                  : new Date(g.expiresAt) <= new Date()
                    ? "Expirată"
                    : `Expiră: ${new Date(g.expiresAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}`}
                {g.offline ? " · acces în fundal" : ""}
              </p>
            </div>
            {!g.revokedAt && (
              <button
                disabled={busy}
                className="focus-button secondary"
                onClick={() =>
                  void command({ action: "revoke_grant", id: g.id })
                }
              >
                Revocă accesul
              </button>
            )}
          </article>
        ))}
      </section>
      {state.canManage && (
        <section className="space-y-4 rounded-2xl border border-focus-line focus-card p-5">
          <h2 className="text-xl font-bold">Clienți OAuth aprobați</h2>
          {!state.clients.length && <p>Nicio conexiune înregistrată.</p>}
          {state.clients.map((c) => (
            <article
              key={c.id}
              className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border border-focus-line p-4"
            >
              <div className="min-w-0">
                <p className="font-semibold">{c.name}</p>
                <p className="break-all text-sm">{c.id}</p>
                {c.redirectUris.map((uri) => (
                  <p key={uri} className="break-all text-sm">
                    {uri}
                  </p>
                ))}
                <p className="break-words text-sm">
                  {c.allowedScopes.join(", ")}
                </p>
              </div>
              {c.disabledAt ? (
                <p>Dezactivat</p>
              ) : (
                <button
                  disabled={busy}
                  className="focus-button secondary"
                  onClick={() =>
                    void command({ action: "disable_client", id: c.id })
                  }
                >
                  Dezactivează și revocă toate delegările
                </button>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
