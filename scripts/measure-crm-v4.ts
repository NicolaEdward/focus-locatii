import type { AuthSession } from "../src/lib/auth";
import { getCrmWorkspace } from "../src/lib/crm-domain-service";
import { prisma } from "../src/lib/prisma";

const actor = {
  id: "crm-read-only-measurement",
  name: "CRM measurement",
  email: "crm-measurement@example.test",
  role: "SUPER_ADMIN",
  tokenVersion: 0,
  iat: 0,
  exp: 4_102_444_800
} satisfies AuthSession;

async function main() {
  const runs: Array<{ durationMs: number; payloadBytes: number; rows: number }> = [];
  for (let index = 0; index < 4; index += 1) {
    const startedAt = performance.now();
    const workspace = await getCrmWorkspace({ view: "opportunities", limit: 25 }, actor);
    runs.push({
      durationMs: Math.round(performance.now() - startedAt),
      payloadBytes: Buffer.byteLength(JSON.stringify(workspace)),
      rows: workspace.records.opportunities.length
    });
  }
  const warm = runs.slice(1).map((run) => run.durationMs).sort((left, right) => left - right);
  console.log(JSON.stringify({ mode: "read-only", cold: runs[0], warmMedianMs: warm[Math.floor(warm.length / 2)], runs }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
