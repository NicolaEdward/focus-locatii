import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { addCrmContact } from "@/lib/crm-service";
import { crmLegacyWriteDisabledResponse } from "@/lib/crm-legacy";

type Context = { params: Promise<{ id: string }> };

const optionalEmail = z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? null : value,
  z.string().trim().email().nullable().optional()
);

const schema = z.object({
  name: z.string().trim().min(2).max(191),
  role: z.string().trim().max(191).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  email: optionalEmail,
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional()
});

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  return crmLegacyWriteDisabledResponse();
}
