import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { listOperationalExecutionHistory } from "@/lib/operational-execution-history";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["dashboard.operations.view", "reservations.view", "reservations.view.own"]);
  if (response || !session) {
    if (response) for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
  try {
    return NextResponse.json(await listOperationalExecutionHistory(session, {
      month: request.nextUrl.searchParams.get("month") || "",
      after: request.nextUrl.searchParams.get("after"),
      pageSize: Number(request.nextUrl.searchParams.get("pageSize") || 20)
    }), { headers });
  } catch (error) {
    const code = error && typeof error === "object" && "status" in error ? Number(error.status) : 503;
    const status = [400, 403].includes(code) ? code : 503;
    return NextResponse.json({ error: status === 503 ? "Registrul execuțiilor este temporar indisponibil. Reîncearcă încărcarea." : (error as Error).message }, { status, headers });
  }
}
