import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { CommercialError } from "@/lib/commercial-workbench-core";
import {
  stopCommercialAutomation,
  executeCommercialHold,
  readCommercialReceipt,
  commercialWorkspace,
  commercialAvailability,
  saveCommercialPolicy,
  issueAgentPrincipal,
  revokeAgentPrincipal,
  createCommercialQuote,
  requestCommercialApproval,
  decideCommercialApproval,
  recordCommercialAcceptance,
  saveDoohProfile,
  checkDoohCapacity,
  bookDoohCapacity,
  cancelDoohCapacity,
  recordDoohProof,
  listDoohBookings,
  createSalesPilot,
  decideSalesPilot,
  enrollPilotCase,
  reviewPilotCase,
  salesPilotReport,
  suppressCommercialRecipient,
  queueCommercialDispatch,
  processCommercialDispatch,
  generateQuoteDraft,
  commercialNoStoreHeaders,
} from "@/lib/commercial-workbench";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, [
    "reservations.view",
    "reservations.view.own",
  ]);
  if (response || !session) return response;
  try {
    const pilotId = request.nextUrl.searchParams.get("pilotId");
    const receiptId = request.nextUrl.searchParams.get("receiptId");
    const result = receiptId
      ? await readCommercialReceipt(receiptId, session)
      : pilotId
        ? await salesPilotReport(pilotId, session)
        : {
            ...(await commercialWorkspace(session)),
            doohBookings: await listDoohBookings(session),
          };
    return NextResponse.json(result, { headers: commercialNoStoreHeaders });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, [
    "reservations.manage",
    "reservations.manage.own",
  ]);
  if (response || !session) return response;
  try {
    const body = z
      .object({ action: z.string().min(1).max(80), input: z.unknown() })
      .strict()
      .parse(await request.json());
    let result: unknown;
    switch (body.action) {
      case "policy.stopAll":
        result = await stopCommercialAutomation(session);
        break;
      case "hold.execute":
        result = await executeCommercialHold(body.input, session);
        break;
      case "policy.save":
        result = await saveCommercialPolicy(body.input, session);
        break;
      case "principal.issue":
        result = await issueAgentPrincipal(body.input, session);
        break;
      case "principal.revoke":
        result = await revokeAgentPrincipal(
          z
            .object({ id: z.string().min(1) })
            .strict()
            .parse(body.input).id,
          session,
        );
        break;
      case "availability.check":
        result = await commercialAvailability(body.input);
        break;
      case "quote.create":
        result = await createCommercialQuote(body.input, session);
        break;
      case "approval.request":
        result = await requestCommercialApproval(body.input, session);
        break;
      case "approval.decide":
        result = await decideCommercialApproval(body.input, session);
        break;
      case "quote.acceptance":
        result = await recordCommercialAcceptance(body.input, session);
        break;
      case "quote.generate":
        result = await generateQuoteDraft(body.input, session);
        break;
      case "dispatch.queue":
        result = await queueCommercialDispatch(body.input, session);
        break;
      case "dispatch.process":
        result = await processCommercialDispatch(
          z
            .object({ id: z.string().min(1) })
            .strict()
            .parse(body.input).id,
          session,
        );
        break;
      case "recipient.suppress":
        result = await suppressCommercialRecipient(body.input, session);
        break;
      case "dooh.profile":
        result = await saveDoohProfile(body.input, session);
        break;
      case "dooh.check":
        result = await checkDoohCapacity(body.input, session);
        break;
      case "dooh.book":
        result = await bookDoohCapacity(body.input, session);
        break;
      case "dooh.cancel":
        result = await cancelDoohCapacity(
          z
            .object({ id: z.string().min(1) })
            .strict()
            .parse(body.input).id,
          session,
        );
        break;
      case "dooh.proof":
        result = await recordDoohProof(body.input, session);
        break;
      case "pilot.create":
        result = await createSalesPilot(body.input, session);
        break;
      case "pilot.decide":
        result = await decideSalesPilot(body.input, session);
        break;
      case "pilot.enroll":
        result = await enrollPilotCase(body.input, session);
        break;
      case "pilot.review":
        result = await reviewPilotCase(body.input, session);
        break;
      default:
        throw new CommercialError(
          "ACTION_NOT_ALLOWED",
          "Acțiune comercială necunoscută.",
        );
    }
    return NextResponse.json({ result }, { headers: commercialNoStoreHeaders });
  } catch (error) {
    return failure(error);
  }
}
function failure(error: unknown) {
  if (error instanceof CommercialError)
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: commercialNoStoreHeaders },
    );
  if (error instanceof z.ZodError)
    return NextResponse.json(
      {
        error: error.issues[0]?.message || "Date invalide.",
        code: "INPUT_INVALID",
      },
      { status: 400, headers: commercialNoStoreHeaders },
    );
  const code =
    error && typeof error === "object" && "code" in error ? error.code : "";
  return NextResponse.json(
    {
      error:
        code === "P2002"
          ? "Operația există deja; reîncarcă rezultatul înainte de a repeta."
          : "Spațiul comercial nu a putut procesa cererea.",
      code: code === "P2002" ? "COMMAND_CONFLICT" : "COMMERCIAL_FAILED",
    },
    { status: code === "P2002" ? 409 : 503, headers: commercialNoStoreHeaders },
  );
}
