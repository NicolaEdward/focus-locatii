import { NextResponse } from "next/server";

export function crmLegacyWriteDisabledResponse() {
  return NextResponse.json({
    error: "CRM-ul vechi este disponibil doar pentru audit. Folosește comenzile CRM curente.",
    code: "CRM_LEGACY_WRITE_DISABLED"
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
