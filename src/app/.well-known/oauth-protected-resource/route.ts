import { NextResponse } from "next/server";
import {
  assistantNoStore,
  assistantResourceMetadata,
  assistantOAuthFailure,
} from "@/lib/assistant-http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(assistantResourceMetadata(), {
      headers: assistantNoStore,
    });
  } catch (e) {
    return assistantOAuthFailure(e);
  }
}
