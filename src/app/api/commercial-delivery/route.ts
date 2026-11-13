import { NextRequest, NextResponse } from "next/server";
import { CommercialError } from "@/lib/commercial-workbench-core";
import {
  verifyCommercialWebhook,
  applyCommercialDeliveryEvent,
} from "@/lib/commercial-webhook";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    if (!process.env.COMMERCIAL_WEBHOOK_SECRET)
      throw new CommercialError(
        "WEBHOOK_DISABLED",
        "Integrarea nu este configurată.",
        503,
      );
    const reader = request.body?.getReader();
    if (!reader)
      throw new CommercialError("BODY_REQUIRED", "Conținut necesar.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 32000) {
        await reader.cancel();
        throw new CommercialError("BODY_TOO_LARGE", "Conținut prea mare.", 413);
      }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks).toString("utf8"),
      eventId = verifyCommercialWebhook(
        raw,
        request.headers,
        process.env.COMMERCIAL_WEBHOOK_SECRET,
      );
    return NextResponse.json(
      await applyCommercialDeliveryEvent(eventId, JSON.parse(raw)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof CommercialError ? error.code : "WEBHOOK_REJECTED",
      },
      {
        status: error instanceof CommercialError ? error.status : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
