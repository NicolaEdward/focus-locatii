import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Canonical current reports include the active legacy snapshot and every
 * confirmed SmartBill import. Canonical invoices are independent of upload age. */
export async function currentFinancialReportScope() {
  const uploads = await prisma.financialReportUpload.findMany({
    where: {
      status: "confirmed",
      OR: [{ activeVersion: true }, { fileHash: { startsWith: "smartbill-" } }],
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const uploadIds = uploads.map((upload) => upload.id);
  return {
    uploadIds,
    receivables: {
      OR: [{ canonicalKey: { not: null } }, { uploadId: { in: uploadIds } }],
    } satisfies Prisma.FinancialReceivableWhereInput,
    payables: {
      uploadId: { in: uploadIds },
    } satisfies Prisma.FinancialPayableWhereInput,
  };
}
