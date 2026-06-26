import { NextRequest, NextResponse } from "next/server";
import { listPublicLocations } from "@/lib/locations";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const ids = new Set(Array.isArray(body?.ids) ? body.ids.map(String) : []);
  if (ids.size > 200) {
    return NextResponse.json({ error: "Selectia este limitata la 200 de locatii." }, { status: 413 });
  }
  const selected = (await listPublicLocations()).filter((location) => ids.has(location.id));

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    locations: selected
  });
}
