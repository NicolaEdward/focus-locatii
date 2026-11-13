import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { revokeAssistantToken } from "@/lib/assistant-oauth";
import {
  assistantNoStore,
  assistantOAuthFailure,
  assistantReadForm,
} from "@/lib/assistant-http";
import { consumeRateLimit } from "@/lib/security-rate-limit";
import { rateLimitIdentity } from "@/lib/request-security";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const rate = await consumeRateLimit({
      scope: "assistant.oauth.revoke",
      identifier: rateLimitIdentity(request),
      limit: 30,
      windowSeconds: 60,
    });
    if (!rate.allowed)
      return NextResponse.json(
        { error: "slow_down" },
        {
          status: 429,
          headers: {
            ...assistantNoStore,
            "Retry-After": String(rate.retryAfter),
          },
        },
      );
    await revokeAssistantToken(await assistantReadForm(request));
    return new NextResponse(null, { status: 200, headers: assistantNoStore });
  } catch (e) {
    return assistantOAuthFailure(e);
  }
}
