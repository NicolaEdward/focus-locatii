import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { CommercialError } from "@/lib/commercial-workbench-core";
import { commercialOptions } from "@/lib/commercial-options";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["reservations.view", "reservations.view.own"]);
  if (response || !session) {
    if (response) for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
  try {
    return NextResponse.json(await commercialOptions(session, Object.fromEntries(request.nextUrl.searchParams)), { headers });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Verifică filtrele de căutare." }, { status: 400, headers });
    return NextResponse.json({ error: "Opțiunile comerciale nu pot fi încărcate. Încearcă din nou." }, { status: 503, headers });
  }
}
