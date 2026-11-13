import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { confirmRetentionCleanup, getOperationsControls, previewRetentionCleanup, registerBackupEvidence, registerRestoreEvidence, syncOperationsControlAlerts, updateOperationsPolicy } from "@/lib/operations-controls";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: NextRequest) {
  const { session, response } = await requirePermission(request, "audit.view");
  if (response || !session) return response;
  return NextResponse.json(await getOperationsControls(), { headers });
}
export async function POST(request: NextRequest) {
  const { session, response } = await requirePermission(request, "audit.view");
  if (response || !session) return response;
  if (!["COO", "SUPER_ADMIN"].includes(session.role)) return NextResponse.json({ error: "Acces numai pentru administrarea controalelor." }, { status: 403, headers });
  try {
    const body = await limitedJson(request); let result;
    switch (body?.action) {
      case "update_policy": result = await updateOperationsPolicy(body.input, session); break;
      case "register_restore": result = await registerRestoreEvidence(body.receipt, session); break;
      case "register_backup": result = await registerBackupEvidence(body.receipt, session); break;
      case "preview_retention": result = await previewRetentionCleanup(session); break;
      case "confirm_retention": if (typeof body.previewToken !== "string") throw new Error("Preview necesar."); result = await confirmRetentionCleanup(body.previewToken, session); break;
      case "sync_alerts": result = await syncOperationsControlAlerts(); break;
      default: return NextResponse.json({ error: "Actiune necunoscuta." }, { status: 400, headers });
    }
    return NextResponse.json({ result, state: await getOperationsControls() }, { headers });
  } catch (error) {
    const databaseError = error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientInitializationError;
    return NextResponse.json({ error: databaseError ? "Controlul nu a putut fi verificat. Reîncarcă datele înainte de reîncercare." : error instanceof SyntaxError ? "Corpul JSON nu este valid." : error instanceof Error ? error.message : "Controlul nu a putut fi actualizat." }, { status: databaseError ? 503 : 400, headers });
  }
}
async function limitedJson(request: NextRequest) {
  const limit = 128 * 1024, reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("JSON lipsă");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error("Cererea depășește limita de 128 KiB."); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}
