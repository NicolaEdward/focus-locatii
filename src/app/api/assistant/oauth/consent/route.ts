import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAuthSessionFromRequest } from "@/lib/auth";
import {
  AssistantOAuthError,
  decideAssistantConsent,
} from "@/lib/assistant-oauth";
import {
  assistantNoStore,
  assistantOAuthFailure,
  assistantReadForm,
} from "@/lib/assistant-http";
import { mutationRequestError } from "@/lib/request-security";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const origin = mutationRequestError(request);
  if (origin) return origin;
  try {
    const session = await getAuthSessionFromRequest(request);
    if (!session)
      throw new AssistantOAuthError(
        "access_denied",
        "Autentificare necesară.",
        401,
      );
    const result = await decideAssistantConsent(
      await assistantReadForm(request),
      session,
    );
    if (request.headers.get("accept")?.includes("application/json")) {
      return NextResponse.json(result, { headers: assistantNoStore });
    }
    return new NextResponse(null, {
      status: 303,
      headers: { ...assistantNoStore, Location: result.redirect },
    });
  } catch (e) {
    return assistantOAuthFailure(e);
  }
}
