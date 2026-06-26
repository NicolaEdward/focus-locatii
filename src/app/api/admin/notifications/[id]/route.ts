import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { updateNotificationAction } from "@/lib/notifications";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const schema = z.object({
  action: z.enum(["called", "note", "follow_up", "partial_collected", "collected", "escalate", "resolve"]),
  note: z.string().trim().max(2000).nullable().optional()
});

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAdmin(request);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const input = schema.parse(await request.json());
    const notification = await updateNotificationAction(id, input.action, input.note || null, session, request);
    return NextResponse.json({ notification }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Notificarea nu a putut fi actualizata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
