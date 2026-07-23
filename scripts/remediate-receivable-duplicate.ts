import { loadEnvFile } from "./release/env-utils";

loadEnvFile(process.env.ENV_FILE || ".env.local");

type Options = {
  primaryId: string;
  duplicateId: string;
  actorUserId: string;
  expectedInvoice: string;
  reason: string;
  write: boolean;
};

async function main() {
  const options = readOptions(process.argv.slice(2));
  const [{ prisma }, { receivableCanonicalKey }, { recalculateFinancialSnapshots }] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/receivables-domain"),
    import("../src/lib/financial-review")
  ]);

  try {
    const [primary, duplicate, actor] = await Promise.all([
      loadReceivable(prisma, options.primaryId),
      loadReceivable(prisma, options.duplicateId),
      prisma.user.findUnique({ where: { id: options.actorUserId }, select: { id: true, role: true } })
    ]);
    if (!actor || !["COO", "SUPER_ADMIN"].includes(actor.role)) {
      throw new Error("Actorul remedierii trebuie să fie COO sau SUPER_ADMIN.");
    }
    validatePair(primary, duplicate, options.expectedInvoice);

    const report = {
      mode: options.write ? "write" : "dry-run",
      invoice: primary.invoiceNumber,
      primaryId: primary.id,
      duplicateId: duplicate.id,
      primaryClientId: primary.clientId,
      duplicateClientId: duplicate.clientId,
      importRowsToMove: duplicate.importRows.length,
      duplicateDependencies: dependencyCounts(duplicate),
      reason: options.reason
    };
    if (!options.write) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const canonicalKey = receivableCanonicalKey({
      companyCode: primary.companyCode!,
      normalizedInvoiceNumber: primary.normalizedInvoiceNumber!,
      currency: primary.currency!
    });
    await prisma.$transaction(async (tx) => {
      const [currentPrimary, currentDuplicate] = await Promise.all([
        loadReceivable(tx, primary.id),
        loadReceivable(tx, duplicate.id)
      ]);
      validatePair(currentPrimary, currentDuplicate, options.expectedInvoice);
      for (const row of currentDuplicate.importRows) {
        await tx.financialReceivableImportRow.update({
          where: { id: row.id },
          data: {
            receivableId: currentPrimary.id,
            clientId: currentPrimary.clientId,
            resolutionReason: [row.resolutionReason, options.reason].filter(Boolean).join(" | ")
          }
        });
      }
      await tx.financialReceivable.update({
        where: { id: currentPrimary.id },
        data: { canonicalKey }
      });
      await tx.financialReceivable.update({
        where: { id: currentDuplicate.id },
        data: {
          canonicalKey: null,
          includedInReport: false,
          status: "archived",
          rowType: "duplicate",
          excludeReason: options.reason,
          reviewNote: `Duplicat păstrat pentru istoric. Factura canonică: ${currentPrimary.id}`,
          reviewedByUserId: actor.id,
          reviewedAt: new Date()
        }
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "receivable.client_misallocation_corrected",
          entityType: "financial_receivable",
          entityId: currentDuplicate.id,
          metadata: {
            primaryInvoiceId: currentPrimary.id,
            duplicateInvoiceId: currentDuplicate.id,
            invoiceNumber: currentPrimary.invoiceNumber,
            previousClientId: currentDuplicate.clientId,
            canonicalClientId: currentPrimary.clientId,
            movedImportRowIds: currentDuplicate.importRows.map((row: { id: string }) => row.id),
            reason: options.reason
          }
        }
      });
    }, { timeout: 30_000 });

    await recalculateFinancialSnapshots(primary.uploadId);
    if (primary.uploadId !== duplicate.uploadId) await recalculateFinancialSnapshots(duplicate.uploadId);
    console.log(JSON.stringify({ ...report, completed: true, canonicalKey }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function readOptions(args: string[]): Options {
  const values = new Map(args.filter((arg) => arg.startsWith("--") && arg.includes("=")).map((arg) => {
    const separator = arg.indexOf("=");
    return [arg.slice(2, separator), arg.slice(separator + 1)];
  }));
  const options = {
    primaryId: values.get("primary-id") || "",
    duplicateId: values.get("duplicate-id") || "",
    actorUserId: values.get("actor-user-id") || "",
    expectedInvoice: values.get("expected-invoice") || "",
    reason: values.get("reason") || "",
    write: args.includes("--write")
  };
  if (!options.primaryId || !options.duplicateId || !options.actorUserId || !options.expectedInvoice || !options.reason) {
    throw new Error("Sunt obligatorii --primary-id, --duplicate-id, --actor-user-id, --expected-invoice și --reason.");
  }
  return options;
}

async function loadReceivable(client: any, id: string) {
  const row = await client.financialReceivable.findUnique({
    where: { id },
    include: {
      payments: { where: { status: "active" }, select: { id: true } },
      documents: { select: { id: true } },
      credits: { select: { id: true } },
      importRows: { select: { id: true, resolutionReason: true } }
    }
  });
  if (!row) throw new Error(`Factura ${id} nu există.`);
  return row;
}

function validatePair(primary: Awaited<ReturnType<typeof loadReceivable>>, duplicate: Awaited<ReturnType<typeof loadReceivable>>, expectedInvoice: string) {
  if (primary.id === duplicate.id) throw new Error("Factura principală și duplicatul trebuie să fie diferite.");
  if (!primary.includedInReport) throw new Error("Factura principală nu este activă.");
  if (!duplicate.includedInReport) throw new Error("Duplicatul este deja arhivat.");
  if (!primary.clientId) throw new Error("Factura principală nu are client canonic.");
  if (primary.companyCode !== duplicate.companyCode || primary.normalizedInvoiceNumber !== duplicate.normalizedInvoiceNumber || primary.currency !== duplicate.currency) {
    throw new Error("Înregistrările nu au aceeași identitate de factură.");
  }
  if ((primary.invoiceNumber || "").toLowerCase() !== expectedInvoice.toLowerCase()) {
    throw new Error("Numărul facturii nu corespunde valorii așteptate.");
  }
  if (!primary.invoicedAmount?.equals(duplicate.invoicedAmount || 0)) {
    throw new Error("Valorile facturilor diferă.");
  }
  const dependencies = dependencyCounts(duplicate);
  if (dependencies.payments || dependencies.documents || dependencies.credits || duplicate.billingItemId || duplicate.campaignId) {
    throw new Error("Duplicatul are dependențe financiare sau comerciale și nu poate fi remediat automat.");
  }
}

function dependencyCounts(row: Awaited<ReturnType<typeof loadReceivable>>) {
  return {
    payments: row.payments.length,
    documents: row.documents.length,
    credits: row.credits.length,
    importRows: row.importRows.length
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
