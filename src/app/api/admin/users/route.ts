import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission, requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { createUser, listUsers } from "@/lib/users";
import { rateLimitIdentity } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-rate-limit";

export async function GET(request: NextRequest) {
  const { response } = await requireAnyPermission(request, ["users.view", "users.manage"]);
  if (response) return response;
  return NextResponse.json({ users: await listUsers() });
}

export async function POST(request: NextRequest) {
  const { session, response } = await requirePermission(request, "users.manage");
  if (response || !session) return response;
  const limit = await consumeRateLimit({ scope: "auth.admin.user.create", identifier: rateLimitIdentity(request, session.id), limit: 10, windowSeconds: 60 * 60 });
  if (!limit.allowed) return NextResponse.json({ error: "Limita de creare a conturilor a fost atinsa temporar." }, { status: 429 });
  try {
    const input = await request.json();
    const user = await createUser(input, session.role);
    await recordAudit({
      actor: session,
      action: "user.create",
      entityType: "user",
      entityId: user.id,
      metadata: {
        reason: typeof input?.reason === "string" ? input.reason.trim().slice(0, 500) : null,
        before: null,
        after: { role: user.role, active: user.active }
      },
      request
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Utilizatorul nu a putut fi creat." },
      { status: 400 }
    );
  }
}
