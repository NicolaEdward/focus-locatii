import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { getUserAuditEvents } from "@/lib/users";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { response } = await requireAnyPermission(request, ["users.view", "users.manage", "audit.view"]);
  if (response) return response;

  try {
    const { id } = await context.params;
    return NextResponse.json({ events: await getUserAuditEvents(id) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Istoricul nu a putut fi incarcat." },
      { status: 404 }
    );
  }
}
