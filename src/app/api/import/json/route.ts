import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { createLocation, updateLocation } from "@/lib/location-mutations";
import { prisma } from "@/lib/prisma";
import { locationInputSchema, locationPatchSchema } from "@/lib/validation";

const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_JSON_NODES = 50_000;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export async function POST(request: NextRequest) {
  const { response } = await requirePermission(request, "inventory.manage");
  if (response) return response;

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_JSON_BYTES) {
    return NextResponse.json({ error: "Importul JSON depășește limita de 5 MB." }, { status: 413 });
  }
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType && contentType !== "application/json") {
    return NextResponse.json({ error: "Importul trebuie trimis ca application/json." }, { status: 415 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_JSON_BYTES) {
    return NextResponse.json({ error: "Importul JSON depășește limita de 5 MB." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
    validateJsonShape(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "JSON invalid." }, { status: 400 });
  }
  const locationsValue = body && typeof body === "object" ? Object.getOwnPropertyDescriptor(body, "locations")?.value : null;
  const locations = Array.isArray(locationsValue) ? locationsValue : [];
  if (locations.length > 1000) {
    return NextResponse.json({ error: "Importul JSON este limitat la 1000 de locatii per operatiune." }, { status: 413 });
  }
  const codes = locations.map((location) => String(location?.code || "").trim()).filter(Boolean);
  if (new Set(codes).size !== codes.length) {
    return NextResponse.json({ error: "Importul conține coduri de locație duplicate." }, { status: 400 });
  }
  const existingRows = await prisma.location.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
  const existingByCode = new Map(existingRows.map((location) => [location.code, location]));
  const plan = locations.map((location) => {
    const code = String(location?.code || "").trim();
    const existing = code ? existingByCode.get(code) : null;
    return existing
      ? { kind: "update" as const, id: existing.id, data: locationPatchSchema.parse(location) }
      : { kind: "create" as const, data: locationInputSchema.parse(location) };
  });

  let created = 0;
  let updated = 0;
  for (const item of plan) {
    if (item.kind === "update") {
      await updateLocation(item.id, item.data);
      updated += 1;
    } else {
      await createLocation(item.data);
      created += 1;
    }
  }

  return NextResponse.json({ created, updated, total: locations.length });
}

function validateJsonShape(value: unknown) {
  let nodes = 0;
  const visit = (current: unknown, depth: number) => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) throw new Error("Importul JSON este prea complex.");
    if (depth > 12) throw new Error("Importul JSON depășește adâncimea maximă permisă.");
    if (!current || typeof current !== "object") return;
    for (const key of Object.keys(current)) {
      if (UNSAFE_KEYS.has(key.toLowerCase())) throw new Error("Importul JSON conține o cheie nesigură.");
      visit((current as Record<string, unknown>)[key], depth + 1);
    }
  };
  visit(value, 0);
}
