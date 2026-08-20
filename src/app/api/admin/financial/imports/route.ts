import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.view", "finance.validate", "finance.manage"]);
  if (response || !session) return response;
  const page = Math.max(Number(request.nextUrl.searchParams.get("page") || 1), 1);
  const take = Math.min(Math.max(Number(request.nextUrl.searchParams.get("take") || 30), 1), 100);
  const legalEntityId = request.nextUrl.searchParams.get("legalEntityId") || undefined;
  const where = legalEntityId ? { legalEntityId } : {};
  const [total, items] = await Promise.all([
    prisma.financialReportUpload.count({ where }),
    prisma.financialReportUpload.findMany({
      where, orderBy: { uploadedAt: "desc" }, skip: (page - 1) * take, take,
      select: {
        id: true, uploadedAt: true, reportDate: true, originalFileName: true, fileHash: true, fileSize: true, status: true,
        importType: true, parserName: true, parserVersion: true, rowsRead: true, rowsCreated: true, rowsUpdated: true,
        rowsDuplicate: true, rowsIgnored: true, rowsFailed: true, warningCount: true, errorSummary: true,
        legalEntity: { select: { code: true, legalName: true } }, uploadedBy: { select: { name: true } },
        _count: { select: { issues: true } },
        issues: { orderBy: { createdAt: "asc" }, take: 5, select: { rowNumber: true, issueType: true, issueMessage: true, severity: true } }
      }
    })
  ]);
  return NextResponse.json({ items, pagination: { page, take, total, totalPages: Math.max(1, Math.ceil(total / take)) } }, { headers: { "Cache-Control": "no-store" } });
}
