import { NextResponse, type NextRequest } from "next/server";
import type { UserRole } from "@/lib/rbac";

export type DceoRequestClassification =
  | "SAFE_READ"
  | "READ_ONLY_COMPUTATION"
  | "ACCOUNT_SECURITY"
  | "BUSINESS_MUTATION";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const D_CEO_READ_ONLY_POST_ALLOWLIST = new Set([
  "/api/admin/location-selection/availability",
  "/api/admin/reservations/conflict-preview",
  "/api/shortlist/excel",
  "/api/shortlist/print"
]);

export const D_CEO_READ_ONLY_GET_EXPORT_ALLOWLIST = new Set([
  "/api/admin/availability/excel",
  "/api/admin/sales-report/excel"
]);

const D_CEO_ACCOUNT_SECURITY_PREFIXES = [
  "/api/auth/logout",
  "/api/auth/security/",
  "/api/auth/password-reset/"
];

export function classifyDceoRequest(method: string, pathname: string): DceoRequestClassification {
  const normalizedMethod = method.toUpperCase();
  if (SAFE_METHODS.has(normalizedMethod)) {
    if (normalizedMethod === "GET" && isUnauditedExport(pathname)) return "BUSINESS_MUTATION";
    return "SAFE_READ";
  }
  if (normalizedMethod === "POST" && D_CEO_READ_ONLY_POST_ALLOWLIST.has(pathname)) {
    return "READ_ONLY_COMPUTATION";
  }
  if (D_CEO_ACCOUNT_SECURITY_PREFIXES.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix))) {
    return "ACCOUNT_SECURITY";
  }
  return "BUSINESS_MUTATION";
}

function isUnauditedExport(pathname: string) {
  const looksLikeExport =
    pathname.includes("/export") ||
    pathname.endsWith("/excel") ||
    pathname.endsWith("/print") ||
    pathname.endsWith(".xlsx");
  return looksLikeExport && !D_CEO_READ_ONLY_GET_EXPORT_ALLOWLIST.has(pathname);
}

export function dceoBusinessMutationError(request: NextRequest, role: UserRole) {
  if (role !== "D_CEO") return null;
  if (classifyDceoRequest(request.method, request.nextUrl.pathname) !== "BUSINESS_MUTATION") return null;
  return NextResponse.json(
    { error: "Rolul D-CEO are acces global strict read-only." },
    { status: 403 }
  );
}
