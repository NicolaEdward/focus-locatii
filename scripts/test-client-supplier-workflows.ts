import assert from "node:assert/strict";
import { getClientCampaignsData } from "../src/lib/client-campaigns";
import { findOrCreateClientAccount, normalizeClientName } from "../src/lib/clients";
import { prisma } from "../src/lib/prisma";
import { createSupplier, updateSupplier } from "../src/lib/suppliers";
import type { AuthSession } from "../src/lib/auth";

async function main() {
  const user = await prisma.user.findFirst({
    where: { active: true, role: { in: ["SUPER_ADMIN", "COO", "SALES_DIRECTOR"] } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }]
  });
  assert(user, "Need an active admin/COO/sales director user for workflow tests.");

  const now = Math.floor(Date.now() / 1000);
  const session: AuthSession = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as AuthSession["role"],
    tokenVersion: user.tokenVersion,
    iat: now,
    exp: now + 3600
  };

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const clientNames = [
    `Codex QA Client Direct ${suffix}`,
    `Codex QA Agentie ${suffix}`,
    `Codex QA Client cu CUI ${suffix}`,
    `Codex QA Search Visible ${suffix}`,
    `Codex QA Zero Campaign ${suffix}`,
    `Codex QA Owner Visible ${suffix}`
  ];
  const createdClientIds: string[] = [];
  let supplierId: string | null = null;

  try {
    for (const [index, companyName] of clientNames.entries()) {
      const client = await findOrCreateClientAccount({
        companyName,
        email: `qa-${index}-${suffix}@example.invalid`,
        phone: `07000000${index}`,
        accountOwnerUserId: user.id
      }, session);
      assert(client, `Client ${companyName} should be created.`);
      createdClientIds.push(client.id);
      await prisma.clientAccount.update({
        where: { id: client.id },
        data: {
          status: "active",
          clientType: index === 1 ? "agency" : "direct_client",
          taxId: index === 2 ? `QA-CUI-${suffix}` : null,
          notes: "Created by automated client workflow regression test."
        }
      });
    }

    const allClients = await getClientCampaignsData(session);
    for (const clientId of createdClientIds) {
      const listed = allClients.clients.find((client) => client.clientId === clientId);
      assert(listed, `Created client ${clientId} must appear in unfiltered Clienti list.`);
      assert.equal(listed.status, "active", `Created client ${clientId} must remain active.`);
      assert.equal(listed.source, "client", `Created client ${clientId} must be a real client row.`);
    }

    for (const companyName of clientNames) {
      const result = await getClientCampaignsData(session, companyName);
      assert(
        result.clients.some((client) => client.companyName === companyName),
        `Created client ${companyName} must appear in search results.`
      );
    }

    const normalizedResult = await getClientCampaignsData(session, normalizeClientName(clientNames[0]));
    assert(
      normalizedResult.clients.some((client) => client.clientId === createdClientIds[0]),
      "Created client must be searchable by normalized name."
    );

    const supplier = await createSupplier({
      supplierName: `Codex QA Supplier ${suffix}`,
      taxId: `QA-SUP-${suffix}`,
      generalEmail: `supplier-${suffix}@example.invalid`,
      generalPhone: "0700999999",
      notes: "Created by automated supplier workflow regression test."
    }, session);
    supplierId = supplier.id;
    assert.equal(supplier.status, "active", "New supplier must be active.");

    const activeSupplier = await prisma.supplier.findFirst({
      where: { id: supplier.id, status: { not: "archived" } }
    });
    assert(activeSupplier, "New supplier must appear in active supplier query.");

    const archived = await updateSupplier(supplier.id, { status: "archived" });
    assert.equal(archived.status, "archived", "Supplier archive must set archived status.");

    const hiddenSupplier = await prisma.supplier.findFirst({
      where: { id: supplier.id, status: { not: "archived" } }
    });
    assert.equal(hiddenSupplier, null, "Archived supplier must disappear from active supplier list.");

    console.log(JSON.stringify({
      ok: true,
      checked: [
        "create multiple active clients",
        "unfiltered client list contains newly created clients",
        "client search contains newly created clients",
        "normalized client search works",
        "create supplier",
        "archive supplier",
        "archived supplier hidden from active list"
      ],
      clientsCreatedAndCleaned: createdClientIds.length,
      supplierArchivedAndCleaned: Boolean(supplierId)
    }, null, 2));
  } finally {
    await prisma.clientContact.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.clientDocument.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.clientAccount.deleteMany({ where: { id: { in: createdClientIds } } });
    if (supplierId) {
      await prisma.supplierContact.deleteMany({ where: { supplierId } });
      await prisma.clientDocument.deleteMany({ where: { supplierId } });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect();
  console.error(error);
  process.exit(1);
});
