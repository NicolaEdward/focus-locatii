import { NextRequest, NextResponse } from "next/server";
import { emitStructuredLog, requestCorrelationId } from "@/lib/observability";

export function crmLegacyRetiredResponse(request: NextRequest, replacement: string, operation: "read" | "write" = "read") {
  const correlationId = requestCorrelationId(request);
  emitStructuredLog("warn", "crm_legacy_route_called", {
    route: request.nextUrl.pathname,
    method: request.method,
    operation: `crm.legacy.${operation}`,
    correlationId,
    errorCode: operation === "write" ? "CRM_LEGACY_WRITE_DISABLED" : "CRM_LEGACY_ROUTE_RETIRED"
  });
  return NextResponse.json({
    error: operation === "write"
      ? "CRM-ul vechi este disponibil doar pentru audit. Foloseste comenzile CRM curente."
      : "Aceasta ruta CRM a fost retrasa. Foloseste API-ul CRM v4 indicat.",
    code: operation === "write" ? "CRM_LEGACY_WRITE_DISABLED" : "CRM_LEGACY_ROUTE_RETIRED",
    replacement
  }, {
    status: 410,
    headers: {
      "Cache-Control": "no-store",
      Deprecation: "true",
      Sunset: "Wed, 30 Sep 2026 00:00:00 GMT",
      Link: `<${replacement}>; rel=\"successor-version\"`,
      "x-request-id": correlationId
    }
  });
}
