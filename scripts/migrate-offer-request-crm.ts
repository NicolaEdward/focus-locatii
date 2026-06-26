import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe("ALTER TABLE portfolio_offer_requests MODIFY source TEXT NULL");
  console.log(JSON.stringify({ ok: true, changed: "portfolio_offer_requests.source TEXT" }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
