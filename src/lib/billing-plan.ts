import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import {
  billingFrequencies,
  billingRules,
  calculateBillingItems,
} from "@/lib/billing";
import { companyCodeForEntity } from "@/lib/company-entities";
import { prisma } from "@/lib/prisma";
import { hasAnyPermission } from "@/lib/rbac";
import { recordTransactionalAudit } from "@/lib/transactional-audit";

export async function listBillingPlan(
  input: {
    campaignId?: string;
    currency?: string;
    status?: string;
    page?: number;
  } = {},
) {
  const page = Math.max(1, Math.floor(input.page || 1));
  const where: Prisma.BillingItemWhereInput = {
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.campaignId
      ? { reservation: { is: { campaignId: input.campaignId } } }
      : {}),
    ...(input.status
      ? { status: input.status }
      : { status: { notIn: ["cancelled", "superseded"] } }),
  };
  const [items, total] = await Promise.all([
    prisma.billingItem.findMany({
      where,
      include: {
        reservation: {
          select: {
            id: true,
            campaignId: true,
            status: true,
            ownerId: true,
            location: { select: { code: true } },
            campaign: {
              select: {
                campaignName: true,
                accountOwner: { select: { name: true } },
              },
            },
            owner: { select: { name: true } },
            sellerUser: { select: { name: true } },
          },
        },
        client: { select: { companyName: true } },
        financialAllocations: {
          where: { status: "active" },
          select: {
            netAmount: true,
            receivable: {
              select: {
                id: true,
                invoiceNumber: true,
                collectedAmount: true,
                invoicedAmount: true,
                remainingAmount: true,
                includedInReport: true,
              },
            },
          },
        },
      },
      orderBy: [{ invoiceDate: "asc" }, { id: "asc" }],
      skip: (page - 1) * 40,
      take: 40,
    }),
    prisma.billingItem.count({ where }),
  ]);
  return {
    page,
    total,
    totalPages: Math.max(1, Math.ceil(total / 40)),
    items: items.map((row) => {
      const valid = row.financialAllocations.filter(
        (line) => line.receivable.includedInReport,
      );
      const linked = valid.reduce(
        (sum, line) => sum.plus(line.netAmount),
        new Prisma.Decimal(0),
      );
      return {
        id: row.id,
        clientId: row.clientId,
        client: row.client?.companyName || "Client lipsă",
        campaignId: row.reservation?.campaignId,
        campaign: row.reservation?.campaign?.campaignName,
        locationCode: row.reservation?.location.code,
        responsible:
          row.reservation?.sellerUser?.name ||
          row.reservation?.owner?.name ||
          row.reservation?.campaign?.accountOwner?.name ||
          "Nealocat",
        reservationStatus: row.reservation?.status,
        periodStart: row.billingPeriodStart.toISOString(),
        periodEnd: row.billingPeriodEnd.toISOString(),
        invoiceDate: row.invoiceDate.toISOString(),
        dueDate: row.dueDate.toISOString(),
        amount: row.amount.toFixed(2),
        currency: row.currency,
        companyEntity: row.companyEntity,
        status: row.status,
        linkedAmount: linked.toFixed(2),
        unlinkedAmount: Prisma.Decimal.max(row.amount.minus(linked), 0).toFixed(
          2,
        ),
        invoiceReferences: valid.map((line) => ({
          id: line.receivable.id,
          number: line.receivable.invoiceNumber,
        })),
        isFiscalInvoice: false,
        notes: row.notes,
      };
    }),
  };
}

export async function generateBillingPlan(input: {
  campaignId: string;
  actor: AuthSession;
}) {
  if (
    !hasAnyPermission(input.actor.role, ["finance.validate", "finance.manage"])
  )
    throw new Error("Nu ai permisiunea de planificare financiară.");
  if (!input.campaignId)
    throw new Error("Alege campania pentru generarea planului.");
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM portfolio_campaigns WHERE id = ${input.campaignId} FOR UPDATE`,
      );
      const campaign = await tx.campaign.findUniqueOrThrow({
        where: { id: input.campaignId },
      });
      const reservations = await tx.reservation.findMany({
        where: { campaignId: input.campaignId, status: "BOOKED" },
        orderBy: { id: "asc" },
        take: 501,
      });
      if (reservations.length > 500)
        throw new Error(
          "Campania depășește limita de generare; folosește loturi controlate.",
        );
      if (!reservations.length)
        throw new Error("Campania nu are închirieri BOOKED eligibile.");
      let created = 0,
        unchanged = 0,
        updated = 0;
      const retained = new Set<string>();
      const draftsByReservation = new Map(
        reservations.map((row) => [
          row.id,
          calculateBillingItems({
            ...row,
            monthlyAmount: row.monthlyRentShare ?? row.amount ?? 0,
          }),
        ]),
      );
      const groups = new Map<string, typeof reservations>();
      for (const row of reservations) {
        const key = `${row.contractGroupId || row.id}|${row.periodStart.toISOString()}|${row.periodEnd.toISOString()}|${row.currency}|${row.billingRule}|${row.billingFrequency}`;
        groups.set(key, [...(groups.get(key) || []), row]);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const totalRent = group.reduce(
          (sum, row) => sum.plus(row.monthlyRentShare ?? row.amount ?? 0),
          new Prisma.Decimal(0),
        );
        const targetDrafts = calculateBillingItems({
          ...group[0],
          monthlyAmount: totalRent.toNumber(),
        });
        for (let index = 0; index < targetDrafts.length; index++) {
          const actual = group.reduce(
            (sum, row) =>
              sum.plus(draftsByReservation.get(row.id)?.[index]?.amount || 0),
            new Prisma.Decimal(0),
          );
          const remainder = new Prisma.Decimal(
            targetDrafts[index].amount,
          ).minus(actual);
          const firstDraft = draftsByReservation.get(group[0].id)?.[index];
          if (firstDraft)
            firstDraft.amount = new Prisma.Decimal(firstDraft.amount)
              .plus(remainder)
              .toNumber();
        }
      }
      for (const reservation of reservations) {
        const rent = reservation.monthlyRentShare ?? reservation.amount;
        if (
          !reservation.clientId ||
          !reservation.contractCompany ||
          !reservation.currency ||
          rent == null ||
          rent <= 0
        )
          throw new Error(
            "Planul necesită client, firmă, monedă și preț valide pentru fiecare închiriere.",
          );
        if (
          reservation.clientId !== campaign.clientId ||
          !companyCodeForEntity(reservation.contractCompany) ||
          (campaign.companyEntity &&
            companyCodeForEntity(campaign.companyEntity) !==
              companyCodeForEntity(reservation.contractCompany)) ||
          (campaign.currency && campaign.currency !== reservation.currency)
        )
          throw new Error(
            "Termenii închirierii și ai campaniei diferă (client, firmă sau monedă). Reconciliază înainte de generare.",
          );
        if (
          !billingRules.includes(
            reservation.billingRule as (typeof billingRules)[number],
          ) ||
          !billingFrequencies.includes(
            reservation.billingFrequency as (typeof billingFrequencies)[number],
          ) ||
          !["RON", "EUR"].includes(reservation.currency) ||
          reservation.paymentTermDays == null ||
          reservation.paymentTermDays < 0
        )
          throw new Error(
            "Regula, frecvența, moneda și termenul de plată trebuie stabilite explicit înainte de generare.",
          );
        if (
          reservation.billingRule === "manual_per_contract" ||
          reservation.billingRule === "fixed_custom_date"
        ) {
          if (!reservation.customBillingDate)
            throw new Error(
              "Închirierea cu facturare manuală necesită o dată de facturare explicită.",
            );
        }
        const drafts = draftsByReservation.get(reservation.id) || [];
        for (const draft of drafts) {
          const key = `${reservation.id}|${draft.billingPeriodStart.toISOString()}|${draft.billingPeriodEnd.toISOString()}`;
          const id = `billing-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
          retained.add(id);
          const existing = await tx.billingItem.findUnique({
            where: { id },
            include: {
              financialAllocations: {
                where: { status: "active" },
                select: { id: true },
              },
            },
          });
          if (
            existing?.financialAllocations.length ||
            (existing &&
              existing.status !== "draft" &&
              existing.status !== "superseded")
          ) {
            if (
              existing &&
              (!existing.amount.equals(draft.amount) ||
                existing.currency !== draft.currency ||
                existing.invoiceDate.getTime() !==
                  draft.invoiceDate.getTime() ||
                existing.dueDate.getTime() !== draft.dueDate.getTime() ||
                existing.companyEntity !== reservation.contractCompany)
            )
              throw new Error(
                "Un plan deja asociat unei facturi diferă de noii termeni. Este necesară reconciliere explicită, fără rescrierea istoricului.",
              );
            unchanged++;
            continue;
          }
          const data = {
            ...draft,
            reservationId: reservation.id,
            clientId: reservation.clientId,
            companyEntity: reservation.contractCompany,
            amount: new Prisma.Decimal(draft.amount),
            remainingAmount: new Prisma.Decimal(draft.amount),
            status: "draft",
            notes:
              "Valoare contractuală netă planificată, de verificat și emis extern; nu este factură fiscală și nu se trimite automat.",
          };
          if (
            existing &&
            existing.status === "draft" &&
            existing.amount.equals(data.amount) &&
            existing.currency === data.currency &&
            existing.companyEntity === data.companyEntity &&
            existing.invoiceDate.getTime() === data.invoiceDate.getTime() &&
            existing.dueDate.getTime() === data.dueDate.getTime()
          ) {
            unchanged++;
            continue;
          }
          if (existing) {
            await tx.billingItem.update({ where: { id }, data });
            updated++;
          } else {
            await tx.billingItem.create({ data: { id, ...data } });
            created++;
          }
        }
      }
      const old = await tx.billingItem.findMany({
        where: {
          reservation: { is: { campaignId: input.campaignId } },
          status: "draft",
          id: { startsWith: "billing-" },
        },
        select: { id: true },
      });
      const committed = await tx.billingItem.findMany({
        where: {
          reservation: { is: { campaignId: input.campaignId } },
          id: { startsWith: "billing-" },
          OR: [
            { financialAllocations: { some: { status: "active" } } },
            { status: { notIn: ["draft", "superseded", "cancelled"] } },
          ],
        },
        select: { id: true },
      });
      if (committed.some((row) => !retained.has(row.id)))
        throw new Error(
          "Perioada sau starea unei închirieri cu document fiscal asociat s-a schimbat. Reconciliază pozițiile existente înainte de regenerare.",
        );
      const superseded = old
        .filter((row) => !retained.has(row.id))
        .map((row) => row.id);
      if (superseded.length)
        await tx.billingItem.updateMany({
          where: {
            id: { in: superseded },
            status: "draft",
            financialAllocations: { none: { status: "active" } },
          },
          data: { status: "superseded" },
        });
      await recordTransactionalAudit(tx, {
        actor: input.actor,
        action: "billing.plan_generated",
        entityType: "campaign",
        entityId: input.campaignId,
        metadata: {
          created,
          updated,
          unchanged,
          superseded: superseded.length,
          fiscalIssuance: false,
        },
      });
      return {
        created,
        updated,
        unchanged,
        superseded: superseded.length,
        fiscalIssuance: false,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30_000,
    },
  );
}
