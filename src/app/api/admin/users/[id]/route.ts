import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { updateUser } from "@/lib/users";
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
    const user = await updateUser(id, await request.json(), session.id, session.role);
    await recordAudit({
      actor: session,
      action: "user.update",
      entityType: "user",
      entityId: id,
      metadata: { role: user.role, active: user.active },
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
