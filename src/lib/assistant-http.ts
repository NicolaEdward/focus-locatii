import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AssistantOAuthError,
  assistantBaseUrl,
  assistantResource,
  ASSISTANT_SCOPES,
} from "@/lib/assistant-oauth";
export const assistantNoStore = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export function assistantOAuthFailure(
  error: unknown,
  resourceChallenge = false,
) {
  const known = error instanceof AssistantOAuthError;
  const status = known
    ? error.status
    : error instanceof z.ZodError || error instanceof SyntaxError
      ? 400
      : 503;
  const code = known
    ? error.code
    : status === 400
      ? "invalid_request"
      : "temporarily_unavailable";
  const description = known
    ? error.message
    : status === 400
      ? "Cererea nu este validă."
      : "Conexiunea nu este disponibilă momentan.";
  return NextResponse.json(
    { error: code, error_description: description },
    {
      status,
      headers: {
        ...assistantNoStore,
        ...(resourceChallenge && status === 401
          ? {
              "WWW-Authenticate": `Bearer resource_metadata="${assistantBaseUrl()}/.well-known/oauth-protected-resource/api/mcp", error="invalid_token"`,
            }
          : {}),
      },
    },
  );
}
export async function assistantReadBody(request: Request, max = 32768) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) {
        await reader.cancel();
        throw new AssistantOAuthError(
          "invalid_request",
          "Cererea depășește limita permisă.",
          413,
        );
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}
export async function assistantReadForm(request: NextRequest) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/x-www-form-urlencoded")
  )
    throw new AssistantOAuthError(
      "invalid_request",
      "Este necesar formularul OAuth standard.",
      415,
    );
  const fields = new URLSearchParams(await assistantReadBody(request, 16384)),
    out: Record<string, string> = {};
  for (const [key, value] of fields) {
    if (Object.hasOwn(out, key) || key.length > 100 || value.length > 4096)
      throw new AssistantOAuthError(
        "invalid_request",
        "Câmpuri OAuth duplicate sau nevalide.",
      );
    out[key] = value;
  }
  const basic = request.headers.get("authorization");
  if (basic) {
    if (!/^Basic [A-Za-z0-9+/]+=*$/.test(basic) || out.client_secret)
      throw new AssistantOAuthError(
        "invalid_client",
        "Autentificarea clientului nu este validă.",
        401,
      );
    const decoded = Buffer.from(basic.slice(6), "base64").toString("utf8"),
      colon = decoded.indexOf(":");
    if (colon < 1)
      throw new AssistantOAuthError(
        "invalid_client",
        "Autentificarea clientului nu este validă.",
        401,
      );
    let id: string, secret: string;
    try {
      id = decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, " "));
      secret = decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, " "));
    } catch {
      throw new AssistantOAuthError(
        "invalid_client",
        "Autentificarea clientului nu este validă.",
        401,
      );
    }
    if (out.client_id && out.client_id !== id)
      throw new AssistantOAuthError(
        "invalid_client",
        "Clientul OAuth nu corespunde.",
        401,
      );
    out.client_id = id;
    out.client_secret = secret;
  }
  return out;
}
export function assistantResourceMetadata() {
  return {
    resource: assistantResource(),
    authorization_servers: [assistantBaseUrl()],
    scopes_supported: [...ASSISTANT_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Focus Media — verificări OOH și date operaționale",
  };
}
export function assistantAuthorizationMetadata() {
  const base = assistantBaseUrl();
  return {
    issuer: base,
    authorization_endpoint: base + "/oauth/authorize",
    token_endpoint: base + "/api/assistant/oauth/token",
    revocation_endpoint: base + "/api/assistant/oauth/revoke",
    authorization_response_iss_parameter_supported: true,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    revocation_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    scopes_supported: [...ASSISTANT_SCOPES, "offline_access"],
    client_id_metadata_document_supported: false,
  };
}
export function assistantOriginAllowed(origin: string | null) {
  if (!origin) return true;
  return [
    assistantBaseUrl(),
    "https://chatgpt.com",
    "https://chat.openai.com",
  ].includes(origin);
}
