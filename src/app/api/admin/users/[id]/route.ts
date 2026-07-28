import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getUserAccessState, updateUser } from "@/lib/users";
import { rateLimitIdentity } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requirePermission(request, "users.manage");
  if (response || !session) return response;
  const limit = await consumeRateLimit({ scope: "auth.admin.user.update", identifier: rateLimitIdentity(request, session.id), limit: 30, windowSeconds: 60 * 60 });
  if (!limit.allowed) return NextResponse.json({ error: "Limita de modificari ale conturilor a fost atinsa temporar." }, { status: 429 });
  try {
    const { id } = await context.params;
    const input = await request.json();
    const before = await getUserAccessState(id);
    const user = await updateUser(id, input, session.id, session.role);
    const after = { role: user.role, active: user.active };
    await recordAudit({
      actor: session,
      action: auditAction(before, after),
      entityType: "user",
      entityId: id,
      metadata: {
        reason: typeof input?.reason === "string" ? input.reason.trim().slice(0, 500) : null,
        before,
        after
      },
      request
    });
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Utilizatorul nu a putut fi actualizat." },
      { status: 400 }
    );
  }
}

function auditAction(
  before: { role: string; active: boolean },
  after: { role: string; active: boolean }
) {
  if (before.active !== after.active) return after.active ? "user.activate" : "user.deactivate";
  if (before.role !== after.role) return "user.role.change";
  return "user.profile.update";
}
