import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { updateUser } from "@/lib/users";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requirePermission(request, "users.manage");
  if (response || !session) return response;
  try {
    const { id } = await context.params;
    const user = await updateUser(id, await request.json(), session.id, session.role);
    await recordAudit({
      actor: session,
      action: "user.update",
      entityType: "user",
      entityId: id,
      metadata: { email: user.email, role: user.role, active: user.active },
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
