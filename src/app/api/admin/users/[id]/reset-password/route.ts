import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { updateUser } from "@/lib/users";

type Context = { params: Promise<{ id: string }> };

const inputSchema = z.object({
  password: z.string().min(12).max(128)
});

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requirePermission(request, "users.manage");
  if (response || !session) return response;

  try {
    const { id } = await context.params;
    const input = inputSchema.parse(await request.json());
    const user = await updateUser(id, { password: input.password }, session.id, session.role);
    await recordAudit({
      actor: session,
      action: "user.password.reset",
      entityType: "user",
      entityId: id,
      metadata: { targetEmail: user.email, sessionsRevoked: true },
      request
    });
    return NextResponse.json({ user, sessionsRevoked: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Parola nu a putut fi resetata." },
      { status: 400 }
    );
  }
}
