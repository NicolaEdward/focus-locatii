import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAssistantMcp } from "@/lib/assistant-mcp";
import { authenticateAssistantBearer } from "@/lib/assistant-oauth";
import {
  assistantNoStore,
  assistantOAuthFailure,
  assistantOriginAllowed,
  assistantReadBody,
} from "@/lib/assistant-http";
import { consumeRateLimit } from "@/lib/security-rate-limit";
import { rateLimitIdentity } from "@/lib/request-security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  try {
    if (!assistantOriginAllowed(request.headers.get("origin")))
      return NextResponse.json(
        { error: "origin_not_allowed" },
        { status: 403, headers: assistantNoStore },
      );
    const early = await consumeRateLimit({
      scope: "assistant.mcp.ip",
      identifier: rateLimitIdentity(request),
      limit: 120,
      windowSeconds: 60,
    });
    if (!early.allowed)
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: {
            ...assistantNoStore,
            "Retry-After": String(early.retryAfter),
          },
        },
      );
    const authorization = request.headers.get("authorization"),
      context = await authenticateAssistantBearer(authorization);
    const limit = await consumeRateLimit({
      scope: "assistant.mcp.grant",
      identifier: context.grant.id,
      limit: 60,
      windowSeconds: 60,
    });
    if (!limit.allowed)
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: {
            ...assistantNoStore,
            "Retry-After": String(limit.retryAfter),
          },
        },
      );
    const body = JSON.parse(await assistantReadBody(request));
    const server = createAssistantMcp(context, authorization!);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 32768,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request, {
        parsedBody: body,
      });
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(assistantNoStore))
        headers.set(key, value);
      return new Response(response.body, { status: response.status, headers });
    } finally {
      await server.close();
    }
  } catch (error) {
    return assistantOAuthFailure(error, true);
  }
}
export async function GET(request: NextRequest) {
  try {
    await authenticateAssistantBearer(request.headers.get("authorization"));
    return new NextResponse(null, {
      status: 405,
      headers: { ...assistantNoStore, Allow: "POST, OPTIONS" },
    });
  } catch (error) {
    return assistantOAuthFailure(error, true);
  }
}
export async function DELETE(request: NextRequest) {
  return GET(request);
}
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!assistantOriginAllowed(origin))
    return new NextResponse(null, { status: 403, headers: assistantNoStore });
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...assistantNoStore,
      ...(origin
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : {}),
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
      "Access-Control-Max-Age": "600",
    },
  });
}
