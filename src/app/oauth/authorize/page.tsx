import { getAuthSession } from "@/lib/auth";
import {
  beginAssistantConsent,
  validateAssistantAuthorization,
  AssistantOAuthError,
} from "@/lib/assistant-oauth";
import { consumeRateLimit } from "@/lib/security-rate-limit";
import { LoginForm } from "@/components/admin/LoginForm";
import { FocusLogo } from "@/components/brand/FocusLogo";
import { authEmailCapability } from "@/lib/transactional-email";
import { AssistantConsentForm } from "@/components/admin/AssistantConsentForm";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Autorizează conexiunea ChatGPT",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const raw = await searchParams;
    const validated = await validateAssistantAuthorization(raw);
    const session = await getAuthSession();
    if (!session) {
      const query = new URLSearchParams(validated.input).toString();
      return (
        <main className="focus-shell min-h-screen p-4">
          <div className="mx-auto grid max-w-xl gap-6 py-8">
            <FocusLogo />
            <h1 className="text-xl font-bold">
              Conectare personală la ChatGPT
            </h1>
            <p>
              Autentifică-te în Focus Media. Vei putea verifica și aproba apoi
              accesul cerut.
            </p>
            <LoginForm
              passwordResetAvailable={authEmailCapability().enabled}
              returnTo={`/oauth/authorize?${query}`}
            />
          </div>
        </main>
      );
    }
    const budget = await consumeRateLimit({
      scope: "assistant.oauth.consent",
      identifier: session.id,
      limit: 20,
      windowSeconds: 60,
    });
    if (!budget.allowed)
      throw new AssistantOAuthError(
        "rate_limited",
        "Prea multe cereri de conectare. Reîncearcă într-un minut.",
        429,
      );
    const consent = await beginAssistantConsent(validated.input, session);
    return (
      <main className="focus-shell min-h-screen px-4 py-8">
        <div className="mx-auto grid max-w-xl gap-5 rounded-2xl border border-focus-line focus-card p-6">
          <FocusLogo />
          <h1 data-ui-contrast className="text-2xl font-bold">
            Permiți verificări din ChatGPT?
          </h1>
          <p>
            <strong>{consent.name}</strong> solicită acces personal pentru{" "}
            <strong>{session.email}</strong>. Se aplică permanent rolul și
            portofoliul tău curent.
          </p>
          <p>
            Acces numai pentru citire. Nu poate modifica rezervări, date
            financiare, contracte sau trimite mesaje clienților.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {consent.scopes.map((scope) => (
              <li key={scope}>
                <code>{scope}</code>
              </li>
            ))}
          </ul>
          <p>
            {consent.offline
              ? "Aprobi și verificări în fundal, maximum 7 zile. Reautorizarea va fi necesară după expirare."
              : "Accesul expiră în maximum 15 minute și la expirarea sesiunii curente."}{" "}
            Poți revoca imediat accesul din „Conexiuni ChatGPT”.
          </p>
          <p className="break-all text-sm">
            Revenire numai către adresa înregistrată:{" "}
            <strong>{consent.redirectOrigin}</strong>.
          </p>
          <AssistantConsentForm id={consent.id} nonce={consent.nonce} />
          <a className="underline" href="/admin/assistant-connections">
            Vezi și revocă conexiunile
          </a>
        </div>
      </main>
    );
  } catch (error) {
    const message =
      error instanceof AssistantOAuthError
        ? error.message
        : "Cererea de conectare nu este validă sau serviciul nu este disponibil.";
    return (
      <main className="focus-shell min-h-screen p-6">
        <div className="mx-auto max-w-xl space-y-4">
          <FocusLogo />
          <h1 data-ui-contrast className="text-2xl font-bold">
            Conexiunea nu poate continua
          </h1>
          <p role="alert">{message}</p>
          <a className="underline" href="/admin/assistant-connections">
            Deschide conexiunile aplicației
          </a>
        </div>
      </main>
    );
  }
}
