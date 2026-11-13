import { NextResponse } from "next/server";
import {
  assistantNoStore,
  assistantAuthorizationMetadata,
  assistantOAuthFailure,
} from "@/lib/assistant-http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(assistantAuthorizationMetadata(), {
      headers: assistantNoStore,
    });
  } catch (e) {
    return assistantOAuthFailure(e);
  }
}
