import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const querySchema = z.object({
  kind: z.enum(["client", "supplier"]),
  q: z.string().trim().max(120).optional().default("")
});

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.upload", "finance.confirm", "finance.manage"]);
  if (response || !session) return response;
  const parsed = querySchema.safeParse({
    kind: request.nextUrl.searchParams.get("kind"),
    q: request.nextUrl.searchParams.get("q") || ""
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Cautarea partenerului nu este valida." }, { status: 400 });
  }
  const q = parsed.data.q;
  if (parsed.data.kind === "client") {
    const options = await prisma.clientAccount.findMany({
      where: {
        status: { notIn: ["merged", "archived"] },
        ...(q ? { OR: [{ companyName: { contains: q } }, { taxId: { contains: q } }] } : {})
      },
      select: { id: true, companyName: true, taxId: true },
      orderBy: { companyName: "asc" },
      take: 30
    });
    return NextResponse.json({ options: options.map((option) => ({ id: option.id, name: option.companyName, taxId: option.taxId })) }, { headers: { "Cache-Control": "no-store" } });
  }
  const options = await prisma.supplier.findMany({
    where: {
      status: { not: "archived" },
      ...(q ? { OR: [{ supplierName: { contains: q } }, { taxId: { contains: q } }] } : {})
    },
    select: { id: true, supplierName: true, taxId: true },
    orderBy: { supplierName: "asc" },
    take: 30
  });
  return NextResponse.json({ options: options.map((option) => ({ id: option.id, name: option.supplierName, taxId: option.taxId })) }, { headers: { "Cache-Control": "no-store" } });
}
