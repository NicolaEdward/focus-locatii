import { z } from "zod";
import { ClientMutationError } from "@/lib/clients";
import { emitStructuredLog, requestCorrelationId } from "@/lib/observability";

// Existing domain validations predate typed errors. Only these reviewed literal
// messages may cross the API boundary; unknown Error.message is never public.
const legacyValidationMessages = new Set([
  "Alege doi clienti diferiti.",
  "Alege un agent sau director de vanzari responsabil.",
  "Campania are inchirieri/hold-uri curente sau viitoare. Anuleaza-le sau muta-le inainte de arhivare.",
  "Campania nu exista.",
  "Campania trebuie legata de un client activ.",
  "Clientul nu a putut fi creat.",
  "Clientul nu exista.",
  "Detaliile sunt disponibile doar owner-ului clientului.",
  "Doar COO sau SUPER_ADMIN pot combina clienti.",
  "Firma contractanta trebuie aleasa din lista: Focus Media, Excellence Media sau Focus BG / Focus Media LLC EOOD.",
  "Foloseste actiunea dedicata de arhivare pentru a verifica inchirierile active.",
  "Moneda trebuie sa corespunda inchirierilor confirmate si istoricului de pret. Pentru conversie este necesar un act aditional verificat.",
  "Noul client al campaniei nu este activ.",
  "Noul client trebuie sa apartina portofoliului tau.",
  "Nu ai acces la aceasta campanie.",
  "Nu ai permisiunea sa modifici aceasta campanie.",
  "Nu ai permisiunea sa modifici campanii.",
  "Nu poti asigna inregistrarea catre alt vanzator.",
  "Nu poti crea sau realoca pe alt vanzator.",
  "Nu poti schimba clientul unei campanii cu inchirieri sau hold-uri active. Muta/anuleaza intai inregistrarile legate.",
  "O campanie noua nu poate fi creata direct ca finalizata sau arhivata.",
  "Poti crea campanii doar pentru clientii tai. Un manager trebuie sa aloce mai intai clientul fara responsabil.",
  "Poti edita doar campaniile tale.",
  "Responsabilul trebuie sa fie un utilizator comercial activ.",
  "Status de campanie invalid.",
  "Unul dintre clienti nu exista.",
]);
const diagnostic = /prisma|sqlstate|(?:select|insert|update|delete)\s+.+\s+(?:from|into|set)|database_url|mysql|postgres|connection|econn|etimedout|invocation|server has closed|\/workspace\/|stack trace|password|authorization|bearer/i;
const databaseCode = /^(?:P\d{4}|E(?:CONNREFUSED|CONNRESET|TIMEDOUT|HOSTUNREACH|NETUNREACH|NOTFOUND|PIPE)|ER_[A-Z0-9_]+)$/;
const transitionMessage = /^Tranzitia campaniei din (?:draft|planned|active|completed|cancelled|archived) in (?:draft|planned|active|completed|cancelled|archived) nu este permisa\.$/;
function reviewedValidation(error: unknown): error is Error {
  return error instanceof Error && (legacyValidationMessages.has(error.message) || transitionMessage.test(error.message));
}
function knownDatabaseError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown; message?: unknown };
  return typeof value.name === "string" && /^PrismaClient/.test(value.name)
    || typeof value.code === "string" && databaseCode.test(value.code)
    || typeof value.message === "string" && diagnostic.test(value.message);
}
function safeCode(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return typeof code === "string" && databaseCode.test(code) ? code : "BUSINESS_OPERATION_FAILED";
}

/** Call only with an application-owned fallback, never an interpolated error. */
export function publicBusinessErrorMessage(error: unknown, fallback: string, operation = "client_campaign.operation", request?: Pick<Request, "headers" | "method">) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return "Verifică valorile introduse și câmpurile obligatorii, apoi încearcă din nou.";
  if (error instanceof ClientMutationError && error.message.length <= 1000 && !diagnostic.test(error.message)) return error.message;
  if (reviewedValidation(error)) return error.message;
  emitStructuredLog("error", "business_operation_failed", {
    operation, errorCode: safeCode(error),
    ...(request ? { correlationId: requestCorrelationId(request), method: request.method } : {}),
  });
  const code = safeCode(error);
  if (code === "P2002" || code === "ER_DUP_ENTRY") return "Există deja o înregistrare cu aceste date. Caută înregistrarea existentă înainte să continui.";
  if (["P2003", "P2014", "ER_NO_REFERENCED_ROW_2", "ER_ROW_IS_REFERENCED_2"].includes(code)) return "Datele asociate s-au schimbat sau sunt folosite în alte înregistrări. Reîncarcă dosarul și verifică legăturile.";
  if (code === "P2025") return "Înregistrarea nu mai este disponibilă. Actualizează lista înainte să continui.";
  if (["P2034", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(code)) return "Operația a întâlnit o modificare simultană. Reîncarcă dosarul și verifică situația înainte să continui.";
  return fallback;
}

export function publicBusinessErrorStatus(error: unknown, fallback = 400) {
  if (error instanceof ClientMutationError) return error.status;
  if (error instanceof z.ZodError || error instanceof SyntaxError) return 400;
  if (reviewedValidation(error)) return fallback;
  const code = safeCode(error);
  if (code === "P2025") return 404;
  if (["P2002", "P2003", "P2014", "P2034", "ER_DUP_ENTRY", "ER_NO_REFERENCED_ROW_2", "ER_ROW_IS_REFERENCED_2", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(code)) return 409;
  return knownDatabaseError(error) ? 503 : 500;
}
