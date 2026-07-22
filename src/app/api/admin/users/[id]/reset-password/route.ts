import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { updateUser } from "@/lib/users";
import { rateLimitIdentity } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";
import { revokeAllAuthSessions } from "@/lib/auth-sessions";

type Context = { params: Promise<{ id: string }> };

const inputSchema = z.object({
  password: z.string().min(12).max(128)
});

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requirePermission(request, "users.manage");
  if (response || !session) return response;

  const limit = await consumeRateLimit({ scope: "auth.admin.password.reset", identifier: rateLimitIdentity(request, session.id), limit: 10, windowSeconds: 60 * 60 });
  if (!limit.allowed) return NextResponse.json({ error: "Limita de resetari a fost atinsa temporar." }, { status: 429 });

  try {
    const { id } = await context.params;
    const input = inputSchema.parse(await request.json());
    const user = await updateUser(id, { password: input.password }, session.id, session.role);
    await revokeAllAuthSessions(id);
    await recordAudit({
      actor: session,
      action: "user.password.reset",
      entityType: "user",
      entityId: id,
      metadata: { targetRole: user.role, sessionsRevoked: true },
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
