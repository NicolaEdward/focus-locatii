import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { getAdminLocation } from "../src/lib/locations";
import { updateLocation } from "../src/lib/location-mutations";
import { assertSyntheticEnvironment } from "./release/env-utils";

assertSyntheticEnvironment();
const tag = `private-read-${randomUUID()}`;
async function main() {
  const category = await prisma.category.create({ data: { name: tag, slug: tag } });
  const owners = await Promise.all(["a", "b"].map((suffix) => prisma.user.create({ data: { name: tag + suffix, email: `${tag}-${suffix}@example.invalid`, role: "SALES_AGENT", passwordHash: "unused-synthetic" } })));
  const location = await prisma.location.create({ data: { code: tag, categoryId: category.id, city: "Synthetic", address: tag, type: "Backlit", status: "AVAILABLE", showInPublic: false } });
  try {
    const secret = `${tag}-foreign-confidential-note`;
    const foreign = await prisma.reservation.create({ data: { locationId: location.id, ownerId: owners[1].id, sellerUserId: owners[1].id, status: "BOOKED", clientName: `${tag}-foreign-client`, notes: secret, amount: 100, periodStart: new Date("2020-01-01"), periodEnd: new Date("2099-12-31") } });
    const own = await prisma.reservation.create({ data: { locationId: location.id, ownerId: owners[0].id, sellerUserId: owners[0].id, status: "RESERVED", clientName: `${tag}-own-client`, notes: `${tag}-own-note`, periodStart: new Date("2100-01-01"), periodEnd: new Date("2100-01-05") } });
    const agent = await getAdminLocation(location.id, owners[0]);
    assert.ok(agent);
    assert.deepEqual(agent.reservations.map((r) => r.id), [own.id]);
    assert.ok(!JSON.stringify(agent).includes(secret));
    assert.ok(!JSON.stringify(agent).includes(foreign.clientName));
    assert.equal(agent.publicStatus, "BOOKED", "The foreign active booking must still block availability");
    const manager = await getAdminLocation(location.id, { ...owners[0], role: "COO" });
    assert.equal(manager?.reservations.length, 2);
    const noActor = await getAdminLocation(location.id);
    assert.deepEqual(noActor?.reservations, []);
    assert.equal(noActor?.publicStatus, agent.publicStatus, "Redaction must not change occupied status");
    await prisma.reservation.deleteMany({ where: { locationId: location.id } });
    const operator = await prisma.user.create({ data: { name: tag + "coo", email: `${tag}-coo@example.invalid`, role: "COO", passwordHash: "unused-synthetic" } });
    owners.push(operator);
    const updated = await updateLocation(location.id, { type: "LED Digital" }, operator);
    assert.equal(updated.type, "Digital", "Inventory edits must preserve the digital medium instead of flattening it to Panou");
    const digital = await getAdminLocation(location.id, owners[0]);
    assert.equal(digital?.publicStatus, "UNKNOWN", "Empty static schedule does not prove available digital capacity");
    assert.ok(digital?.availabilityLabel.includes("DOOH"));
    console.log("Location private-read real DB regression passed: own details, foreign blocker, manager scope, fail-closed");
  } finally {
    await prisma.reservation.deleteMany({ where: { locationId: location.id } });
    await prisma.location.delete({ where: { id: location.id } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: owners.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: owners.map((u) => u.id) } } });
    await prisma.category.delete({ where: { id: category.id } });
  }
}
main().finally(() => prisma.$disconnect()).catch((error) => { console.error(error); process.exitCode = 1; });
