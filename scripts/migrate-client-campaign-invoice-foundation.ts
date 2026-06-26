import { PrismaClient } from "@prisma/client";
import { normalizeClientName, normalizeInvoiceNumber } from "../src/lib/clients";
import { moneyDecimal, moneyNumber } from "../src/lib/money";

const prisma = new PrismaClient();

async function main() {
  const clients = await prisma.clientAccount.findMany({ select: { id: true, companyName: true, normalizedName: true } });
  for (const client of clients) {
    const normalizedName = normalizeClientName(client.companyName);
    if (client.normalizedName !== normalizedName) {
      await prisma.clientAccount.update({ where: { id: client.id }, data: { normalizedName } });
    }
  }

  const receivables = await prisma.financialReceivable.findMany({
    select: {
      id: true,
      invoiceNumber: true,
      normalizedInvoiceNumber: true,
      invoicedAmount: true,
      collectedAmount: true,
      remainingAmount: true,
      status: true
    }
  });
  for (const row of receivables) {
    const normalizedInvoiceNumber = normalizeInvoiceNumber(row.invoiceNumber);
    const total = moneyNumber(row.invoicedAmount);
    const collected = moneyNumber(row.collectedAmount);
    const remaining = row.remainingAmount == null ? Math.max(0, total - collected) : moneyNumber(row.remainingAmount);
    const status = remaining <= 0 && total > 0 ? "collected" : row.status;
    await prisma.financialReceivable.update({
      where: { id: row.id },
      data: {
        normalizedInvoiceNumber,
        remainingAmount: moneyDecimal(remaining),
        status
      }
    });
  }

  const billingItems = await prisma.billingItem.findMany({
    select: {
      id: true,
      invoiceNumber: true,
      normalizedInvoiceNumber: true,
      amount: true,
      collectedAmount: true,
      remainingAmount: true,
      status: true
    }
  });
  for (const item of billingItems) {
    const normalizedInvoiceNumber = normalizeInvoiceNumber(item.invoiceNumber);
    const amount = moneyNumber(item.amount);
    const collected = moneyNumber(item.collectedAmount);
    const remaining = item.remainingAmount == null ? Math.max(0, amount - collected) : moneyNumber(item.remainingAmount);
    const status = remaining <= 0 && amount > 0 ? "collected" : item.status;
    await prisma.billingItem.update({
      where: { id: item.id },
      data: {
        normalizedInvoiceNumber,
        remainingAmount: moneyDecimal(remaining),
        status
      }
    });
  }

  console.log(`Updated ${clients.length} clients, ${receivables.length} receivables, ${billingItems.length} billing items.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
