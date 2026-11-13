import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AuthSession } from "@/lib/auth";
import { hasAnyPermission, hasGlobalDataAccess } from "@/lib/rbac";
import { CommercialError } from "@/lib/commercial-workbench-core";

export const commercialOptionsQuerySchema = z.object({
  kind: z.enum(["clients", "campaigns", "opportunities"]),
  q: z.string().trim().max(120).default(""),
  clientId: z.string().trim().min(1).max(191).optional(),
  ids: z.string().max(9600).optional().transform((value) => value ? [...new Set(value.split(","))] : [])
    .pipe(z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,191}$/)).max(50)),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

/** Search is always scoped before counting, paging or hydrating a selected ID. */
export async function commercialOptions(actor: AuthSession, raw: unknown) {
  if (!hasAnyPermission(actor.role, ["reservations.view", "reservations.view.own"]))
    throw new CommercialError("FORBIDDEN", "Nu ai acces la opțiunile comerciale.", 403);
  const query = commercialOptionsQuerySchema.parse(raw);
  const global = hasGlobalDataAccess(actor.role);
  const skip = (query.page - 1) * query.pageSize;
  const page = (total: number) => ({ page: query.page, pageSize: query.pageSize, total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)) });
  if (query.kind === "clients") {
    const scope = { status: { notIn: ["archived", "merged"] }, ...(global ? {} : { accountOwnerUserId: actor.id }) };
    const where = { ...scope, ...(query.q ? { OR: [{ companyName: { contains: query.q } }, { taxId: { contains: query.q } }] } : {}) };
    const select = { id: true, companyName: true, generalEmail: true,
      contacts: { select: { name: true, email: true, phone: true }, orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }], take: 1 } };
    const [total, rows, selected] = await Promise.all([
      prisma.clientAccount.count({ where }),
      prisma.clientAccount.findMany({ where, select, skip, take: query.pageSize, orderBy: [{ companyName: "asc" }, { id: "asc" }] }),
      query.ids.length ? prisma.clientAccount.findMany({ where: { ...scope, id: { in: query.ids } }, select }) : [],
    ]);
    return { kind: query.kind, page: page(total), rows: rows.map(({ contacts, ...row }) => ({ ...row, primaryContact: contacts[0] || null })),
      selected: selected.map(({ contacts, ...row }) => ({ ...row, primaryContact: contacts[0] || null })) };
  }
  if (query.kind === "campaigns") {
    // A caller cannot use a foreign client ID as an oracle for its campaigns.
    const scope = { archivedAt: null, ...(global ? {} : { sellerUserId: actor.id, client: { accountOwnerUserId: actor.id } }),
      ...(query.clientId ? { clientId: query.clientId } : {}) };
    const where = { ...scope, ...(query.q ? { campaignName: { contains: query.q } } : {}) };
    const select = { id: true, clientId: true, campaignName: true, currency: true, companyEntity: true,
      paymentTermType: true, paymentTermDays: true, billingRule: true, billingFrequency: true, startDate: true, endDate: true, status: true };
    const [total, rows, selected] = await Promise.all([
      prisma.campaign.count({ where }),
      prisma.campaign.findMany({ where, select, skip, take: query.pageSize, orderBy: [{ campaignName: "asc" }, { id: "asc" }] }),
      query.ids.length ? prisma.campaign.findMany({ where: { ...scope, id: { in: query.ids } }, select }) : [],
    ]);
    return { kind: query.kind, page: page(total), rows, selected };
  }
  const scope = global ? {} : { ownerId: actor.id };
  const where = { ...scope, ...(query.q ? { name: { contains: query.q } } : {}) };
  const select = { id: true, name: true, stage: true, version: true };
  const [total, rows, selected] = await Promise.all([
    prisma.crmOpportunity.count({ where }),
    prisma.crmOpportunity.findMany({ where, select, skip, take: query.pageSize, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] }),
    query.ids.length ? prisma.crmOpportunity.findMany({ where: { ...scope, id: { in: query.ids } }, select }) : [],
  ]);
  return { kind: query.kind, page: page(total), rows, selected };
}
