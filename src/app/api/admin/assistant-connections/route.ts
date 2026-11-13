import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAuthSessionFromRequest } from "@/lib/auth";
import {
  AssistantOAuthError,
  assistantConnectionsState,
  disableAssistantClient,
  registerAssistantClient,
  revokeAssistantGrant,
} from "@/lib/assistant-oauth";
import {
  assistantNoStore,
  assistantOAuthFailure,
  assistantReadBody,
} from "@/lib/assistant-http";
import { mutationRequestError } from "@/lib/request-security";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const s = await getAuthSessionFromRequest(request);
    if (!s)
      throw new AssistantOAuthError(
        "access_denied",
        "Autentificare necesară.",
        401,
      );
    return NextResponse.json(await assistantConnectionsState(s), {
      headers: assistantNoStore,
    });
  } catch (e) {
    return assistantOAuthFailure(e);
  }
}
export async function POST(request: NextRequest) {
  const origin = mutationRequestError(request);
  if (origin) return origin;
  try {
    const s = await getAuthSessionFromRequest(request);
    if (!s)
      throw new AssistantOAuthError(
        "access_denied",
        "Autentificare necesară.",
        401,
      );
    const body = JSON.parse(await assistantReadBody(request));
    let result;
    if (body.action === "register_client")
      result = await registerAssistantClient(body.input, s);
    else if (body.action === "revoke_grant" && typeof body.id === "string")
      result = await revokeAssistantGrant(body.id, s);
    else if (body.action === "disable_client" && typeof body.id === "string")
      result = await disableAssistantClient(body.id, s);
    else
      throw new AssistantOAuthError("invalid_request", "Acțiune necunoscută.");
    return NextResponse.json(
      { result, state: await assistantConnectionsState(s) },
      { headers: assistantNoStore },
    );
  } catch (e) {
    return assistantOAuthFailure(e);
  }
}
