import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import {
  applyOwnershipRemediationBatch,
  applySellerReassignment,
  buildOwnershipRemediationDryRun,
  getOwnershipIntegrityReport,
  getSellerReassignmentDryRun,
  rollbackOwnershipRemediationBatch
} from "@/lib/ownership-integrity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" };
const commandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("dry-run"), selectedIds: z.array(z.string().min(1)).max(500).optional() }),
  z.object({
    command: z.literal("apply-safe"), selectedIds: z.array(z.string().min(1)).min(1).max(500),
    expectedBatchId: z.string().min(8), reason: z.string().trim().min(10).max(1000),
    confirmation: z.literal("APLICA BATCH-UL DE OWNERSHIP")
  }),
  z.object({
    command: z.literal("rollback"), batchId: z.string().min(8), reason: z.string().trim().min(10).max(1000),
    confirmation: z.literal("COMPENSEAZA BATCH-UL DE OWNERSHIP")
  }),
  z.object({ command: z.literal("reassign-dry-run"), sourceUserId: z.string().min(1), targetUserId: z.string().min(1) }),
  z.object({
    command: z.literal("reassign-apply"), sourceUserId: z.string().min(1), targetUserId: z.string().min(1),
    expectedBatchId: z.string().min(8), reason: z.string().trim().min(10).max(1000),
    confirmation: z.literal("APLICA REALOCAREA DE OWNERSHIP")
  })
]);

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.response) return auth.response;
  return NextResponse.json({ report: await getOwnershipIntegrityReport() }, { headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.response || !auth.session) return auth.response;
  try {
    const input = commandSchema.parse(await request.json());
    if (input.command === "dry-run") {
      const report = await getOwnershipIntegrityReport();
      return NextResponse.json({ dryRun: buildOwnershipRemediationDryRun(report, input.selectedIds) }, { headers: noStoreHeaders });
    }
    if (input.command === "apply-safe") {
      const result = await applyOwnershipRemediationBatch({ ...input, actorId: auth.session.id });
      return NextResponse.json({ result }, { headers: noStoreHeaders });
    }
    if (input.command === "rollback") {
      const result = await rollbackOwnershipRemediationBatch({ ...input, actorId: auth.session.id });
      return NextResponse.json({ result }, { headers: noStoreHeaders });
    }
    if (input.command === "reassign-dry-run") {
      return NextResponse.json({ dryRun: await getSellerReassignmentDryRun(input.sourceUserId, input.targetUserId) }, { headers: noStoreHeaders });
    }
    const result = await applySellerReassignment({ ...input, actorId: auth.session.id });
    return NextResponse.json({ result }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Comanda de integritate nu a putut fi procesata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

async function authorize(request: NextRequest) {
  const auth = await requirePermission(request, "users.manage");
  if (auth.response || !auth.session) return auth;
  if (!["COO", "SUPER_ADMIN"].includes(auth.session.role)) {
    return { ...auth, response: NextResponse.json({ error: "Raportul este disponibil doar pentru COO si SUPER_ADMIN." }, { status: 403, headers: noStoreHeaders }) };
  }
  return auth;
}
