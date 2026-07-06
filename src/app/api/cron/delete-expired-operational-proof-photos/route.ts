import { NextRequest, NextResponse } from "next/server";
import { OPERATIONAL_PROOF_DOCUMENT_TYPE } from "@/lib/operational-proof";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET lipseste." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const expired = await prisma.clientDocument.findMany({
    where: {
      documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE,
      status: "active",
      expiryDate: { lt: now }
    },
    select: { id: true, notes: true },
    take: 100
  });

  let deleted = 0;
  let failed = 0;

  for (const document of expired) {
    try {
      await prisma.clientDocument.update({
        where: { id: document.id },
        data: {
          status: "deleted",
          storageUrl: `deleted:${document.id}`,
          notes: appendSystemDeletionNote(document.notes)
        }
      });
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error("Expired operational proof photo cleanup failed.", { id: document.id, error });
    }
  }

  return NextResponse.json({ scanned: expired.length, deleted, failed });
}

function appendSystemDeletionNote(value: string | null) {
  const suffix = JSON.stringify({ deletedAt: new Date().toISOString(), deletedBySystem: true });
  return value ? `${value}\n${suffix}` : suffix;
}
