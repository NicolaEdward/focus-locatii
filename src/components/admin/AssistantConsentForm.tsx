"use client";
import { useState } from "react";
export function AssistantConsentForm({
  id,
  nonce,
}: {
  id: string;
  nonce: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const decision = (
          event.nativeEvent as SubmitEvent
        ).submitter?.getAttribute("value");
        if (decision !== "allow" && decision !== "deny") return;
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/assistant/oauth/consent", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: new URLSearchParams({ id, nonce, decision }),
            cache: "no-store",
          });
          const data = await response.json();
          if (!response.ok || typeof data.redirect !== "string")
            throw new Error(data.error_description || "Aprobarea nu a reușit.");
          // Explicit navigation after approval preserves the application's strict
          // form-action 'self' policy while allowing the approved OAuth callback.
          window.location.assign(data.redirect);
        } catch (failure) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Aprobarea nu a reușit.",
          );
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-wrap gap-3">
        <button
          className="focus-button"
          name="decision"
          value="allow"
          disabled={busy}
        >
          Aprobă accesul
        </button>
        <button
          className="focus-button secondary"
          name="decision"
          value="deny"
          disabled={busy}
        >
          Refuză
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <noscript>
        Activează JavaScript pentru autentificare și aprobarea conexiunii.
      </noscript>
    </form>
  );
}
