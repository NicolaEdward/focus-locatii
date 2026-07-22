import { emitStructuredLog } from "@/lib/observability";

export function authEmailCapability() {
  const configured = Boolean(
    process.env.RESEND_API_KEY &&
    process.env.NOTIFICATION_FROM_EMAIL &&
    process.env.NEXT_PUBLIC_BASE_URL
  );
  const enabled = configured && process.env.AUTH_EMAIL_DELIVERY_ENABLED === "true";
  return {
    configured,
    enabled,
    suppressed: process.env.VERCEL_ENV === "preview" || process.env.APP_ENV === "preview"
  };
}

export async function sendAuthEmail(input: { to: string; subject: string; html: string; operation: string }) {
  const capability = authEmailCapability();
  if (!capability.enabled) throw new Error("AUTH_EMAIL_NOT_CONFIGURED");
  if (capability.suppressed) {
    emitStructuredLog("info", "auth_email_suppressed", { operation: input.operation, status: 200 });
    return { id: "suppressed-preview", suppressed: true };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.NOTIFICATION_FROM_EMAIL,
      to: [input.to],
      subject: input.subject,
      html: input.html
    })
  });
  if (!response.ok) {
    emitStructuredLog("error", "auth_email_failed", {
      operation: input.operation,
      status: response.status,
      errorCode: "AUTH_EMAIL_PROVIDER_ERROR"
    });
    throw new Error("AUTH_EMAIL_PROVIDER_ERROR");
  }
  const payload = await response.json().catch(() => null) as { id?: string } | null;
  emitStructuredLog("info", "auth_email_sent", { operation: input.operation, status: 200 });
  return { id: payload?.id || "sent", suppressed: false };
}

export function authLink(path: string, token: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (!base) throw new Error("NEXT_PUBLIC_BASE_URL lipseste.");
  const url = new URL(path, base);
  url.searchParams.set("token", token);
  return url.toString();
}
