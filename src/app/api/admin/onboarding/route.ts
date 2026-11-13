import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthSessionFromRequest } from "@/lib/auth";
import { mutationRequestError } from "@/lib/request-security";
import { onboardingState, OnboardingError, updateOnboardingProgress } from "@/lib/workplace-onboarding";
import { JsonRequestError, readBoundedJson } from "@/lib/bounded-json-request";
import { publicBusinessErrorMessage, publicBusinessErrorStatus } from "@/lib/public-business-error";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    const actor = await getAuthSessionFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Autentificare necesară." }, { status: 401, headers: noStore });
    return NextResponse.json({ state: await onboardingState(actor) }, { headers: noStore });
  } catch (error) {
    return NextResponse.json({ error: publicBusinessErrorMessage(error, "Ghidul nu poate fi încărcat momentan. Reîncarcă pentru a verifica progresul salvat.", "account.onboarding.read", request) }, { status: publicBusinessErrorStatus(error, 503), headers: noStore });
  }
}

export async function PUT(request: NextRequest) {
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const actor = await getAuthSessionFromRequest(request);
  if (!actor) return NextResponse.json({ error: "Autentificare necesară." }, { status: 401, headers: noStore });
  try {
    // This endpoint only saves the caller's own learning checklist, including for
    // read-only/field roles. It cannot modify business data or another account.
    return NextResponse.json({ state: await updateOnboardingProgress(await readBoundedJson(request), actor) }, { headers: noStore });
  } catch (error) {
    if (error instanceof OnboardingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore });
    if (error instanceof JsonRequestError) return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Progresul trimis nu este valid." }, { status: 400, headers: noStore });
    return NextResponse.json({ error: "Progresul nu a putut fi salvat. Reîncarcă pentru a verifica rezultatul." }, { status: 503, headers: noStore });
  }
}
