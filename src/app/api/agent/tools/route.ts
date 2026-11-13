import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateAgentBearer,
  executeAgentTool,
  commercialNoStoreHeaders,
} from "@/lib/commercial-workbench";
import { CommercialError } from "@/lib/commercial-workbench-core";
import { consumeRateLimit } from "@/lib/security-rate-limit";
import { rateLimitSubject } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get("content-length") || "0") > 32000)
      throw new CommercialError(
        "INPUT_TOO_LARGE",
        "Cererea depășește limita.",
        413,
      );
    const principal = await authenticateAgentBearer(
      request.headers.get("authorization"),
    );
    const limit = await consumeRateLimit({
      scope: "agent.tools",
      identifier: rateLimitSubject(principal.id),
      limit: 60,
      windowSeconds: 60,
    });
    if (!limit.allowed)
      return NextResponse.json(
        { error: "Prea multe cereri.", code: "RATE_LIMITED" },
        {
          status: 429,
          headers: {
            ...commercialNoStoreHeaders,
            "Retry-After": String(limit.retryAfter),
          },
        },
      );
    const reader = request.body?.getReader();
    if (!reader)
      throw new CommercialError("INPUT_INVALID", "Conținut necesar.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 32000) {
        await reader.cancel();
        throw new CommercialError(
          "INPUT_TOO_LARGE",
          "Cererea depășește limita.",
          413,
        );
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const result = await executeAgentTool(
      principal,
      JSON.parse(text),
      request.headers.get("x-request-id") || undefined,
    );
    return NextResponse.json(result, {
      status: result.failed ? 400 : 200,
      headers: commercialNoStoreHeaders,
    });
  } catch (error) {
    if (error instanceof CommercialError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: commercialNoStoreHeaders },
      );
    return NextResponse.json(
      {
        error: "Cererea instrumentului nu poate fi executată.",
        code:
          error instanceof z.ZodError || error instanceof SyntaxError
            ? "INPUT_INVALID"
            : "TOOL_UNAVAILABLE",
      },
      {
        status:
          error instanceof z.ZodError || error instanceof SyntaxError
            ? 400
            : 503,
        headers: commercialNoStoreHeaders,
      },
    );
  }
}
