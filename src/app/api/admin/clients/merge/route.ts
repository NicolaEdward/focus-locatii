import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { mergeClientAccounts } from "@/lib/clients";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const mergeSchema = z.object({
  primaryClientId: z.string().trim().min(1),
  duplicateClientId: z.string().trim().min(1),
  reason: z.string().trim().max(1000).nullable().optional()
});

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["clients.manage"]);
  if (response || !session) return response;
  if (!["COO", "SUPER_ADMIN"].includes(session.role)) {
    return NextResponse.json(
      { error: "Doar COO sau SUPER_ADMIN pot combina clienti." },
      { status: 403, headers: noStoreHeaders }
    );
  }

  try {
    const input = mergeSchema.parse(await request.json());
    await mergeClientAccounts(input, session);

    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clientii nu au putut fi combinati.";
    return NextResponse.json(
      { error: message },
      { status: message.includes("nu exista") ? 404 : 400, headers: noStoreHeaders }
    );
  }
}
