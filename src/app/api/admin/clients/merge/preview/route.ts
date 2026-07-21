import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { getClientMergePreview } from "@/lib/client-campaign-workspaces";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["clients.manage"]);
  if (response || !session) return response;
  try {
    const preview = await getClientMergePreview(
      session,
      request.nextUrl.searchParams.get("primaryClientId") || "",
      request.nextUrl.searchParams.get("duplicateClientId") || ""
    );
    return NextResponse.json({ preview }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Preview-ul nu poate fi generat." }, { status: 400, headers });
  }
}
