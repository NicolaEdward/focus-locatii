import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import {
  allocateInvoiceToCampaign,
  approveCampaignCost,
  approveCampaignFinanceCoverage,
  attestInvoiceTaxSplit,
  createCampaignCost,
  getCampaignFinance,
  reverseInvoiceAllocation,
} from "@/lib/campaign-finance";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const id = z.string().min(1).max(191);
const amount = z.string().regex(/^\d+(?:\.\d{1,2})?$/);
const moneyFields = {
  netAmount: amount,
  vatAmount: amount,
  grossAmount: amount,
  currency: z.enum(["RON", "EUR"]),
};
const requestKey = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const association = {
  reservationId: id.nullable().optional(),
  locationId: id.nullable().optional(),
};
const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("allocate"),
    campaignId: id,
    receivableId: id,
    billingItemId: id.nullable().optional(),
    ...association,
    ...moneyFields,
    requestKey,
    notes: z.string().max(2000).nullable().optional(),
  }),
  z.object({
    action: z.literal("reverse_allocation"),
    allocationId: id,
    reason: z.string().min(5).max(2000),
  }),
  z.object({
    action: z.literal("attest_tax"),
    receivableId: id,
    netAmount: z.string().regex(/^-?\d+(?:\.\d{1,2})?$/),
    vatAmount: z.string().regex(/^-?\d+(?:\.\d{1,2})?$/),
    evidenceReference: z.string().min(5).max(2000),
  }),
  z.object({
    action: z.literal("create_cost"),
    campaignId: id,
    legalEntityId: id,
    sourceDocumentId: id.nullable().optional(),
    sourceReference: z.string().min(1).max(500),
    description: z.string().min(5).max(2000),
    costType: z.enum(["media", "print", "installation", "transport", "other"]),
    ...association,
    ...moneyFields,
    requestKey,
  }),
  z.object({
    action: z.literal("approve_cost"),
    costId: id,
    expectedVersion: z.number().int().nonnegative(),
    approve: z.boolean(),
    reason: z.string().min(5).max(2000),
  }),
  z.object({
    action: z.literal("confirm_coverage"),
    campaignId: id,
    currency: z.enum(["RON", "EUR"]),
    expectedFingerprint: z.string().length(64),
    coverageFrom: z.string().datetime(),
    coverageTo: z.string().datetime(),
    notes: z.string().min(10).max(2000),
  }),
]);
export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, [
    "finance.view",
  ]);
  if (response || !session) return response;
  try {
    const input = z
      .object({ campaignId: id, currency: z.enum(["RON", "EUR"]) })
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(
      await getCampaignFinance(input.campaignId, input.currency),
      { headers },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Raportul nu poate fi citit.",
      },
      { status: 400, headers },
    );
  }
}
export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, [
    "finance.validate",
    "finance.manage",
    "finance.confirm",
  ]);
  if (response || !session) return response;
  try {
    const input = command.parse(await request.json());
    let result: unknown;
    switch (input.action) {
      case "allocate":
        result = await allocateInvoiceToCampaign({ ...input, actor: session });
        break;
      case "reverse_allocation":
        result = await reverseInvoiceAllocation({ ...input, actor: session });
        break;
      case "attest_tax":
        result = await attestInvoiceTaxSplit({ ...input, actor: session });
        break;
      case "create_cost":
        result = await createCampaignCost({ ...input, actor: session });
        break;
      case "approve_cost":
        result = await approveCampaignCost({ ...input, actor: session });
        break;
      case "confirm_coverage":
        result = await approveCampaignFinanceCoverage({
          ...input,
          coverageFrom: new Date(input.coverageFrom),
          coverageTo: new Date(input.coverageTo),
          actor: session,
        });
        break;
    }
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Comanda financiară a fost refuzată.",
      },
      { status: 400, headers },
    );
  }
}
