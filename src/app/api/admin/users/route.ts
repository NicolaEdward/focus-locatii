import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { createUser, listUsers } from "@/lib/users";

export async function GET(request: NextRequest) {
  const { response } = await requirePermission(request, "users.manage");
  if (response) return response;
  return NextResponse.json({ users: await listUsers() });
}

export async function POST(request: NextRequest) {
  const { session, response } = await requirePermission(request, "users.manage");
  if (response || !session) return response;
  try {
    const user = await createUser(await request.json(), session.role);
    await recordAudit({
      actor: session,
      action: "user.create",
      entityType: "user",
      entityId: user.id,
      metadata: { email: user.email, role: user.role },
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
