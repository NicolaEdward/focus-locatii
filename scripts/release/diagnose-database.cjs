// Opt-in, read-only diagnostics for a private build log. Never print connection
// credentials, endpoint names, customer records, or raw database exceptions.
const crypto = require("node:crypto");

const poolKeys = ["connection_limit", "connect_timeout", "pool_timeout", "socket_timeout"];
const statusKeys = new Set([
  "Uptime", "Threads_connected", "Threads_running", "Max_used_connections",
  "Aborted_clients", "Aborted_connects", "Connections"
]);

function numeric(value) {
  if (typeof value === "bigint") return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  if (typeof value === "string" && !/^\d+$/.test(value)) return null;
  if (!["string", "number"].includes(typeof value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function safeError(error) {
  if (error && typeof error === "object" && /^P\d{4}$/.test(error.code || "")) return error.code;
  const names = new Set([
    "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError",
    "PrismaClientInitializationError", "PrismaClientRustPanicError", "PrismaClientValidationError"
  ]);
  return names.has(error?.name) ? error.name : "DATABASE_DIAGNOSTICS_FAILED";
}

async function main() {
  if (process.env.RUN_DATABASE_DIAGNOSTICS !== "true") {
    console.log(JSON.stringify({ event: "database_diagnostics", skipped: true }));
    return;
  }

  let prisma;
  try {
    const originalUrl = new URL(process.env.DATABASE_URL);
    if (originalUrl.protocol !== "mysql:") throw new Error();
    const database = decodeURIComponent(originalUrl.pathname.replace(/^\//, ""));
    // Match scripts/release/env-utils.ts databaseIdentity() exactly.
    const endpoint = `${originalUrl.protocol}//${originalUrl.hostname}:${originalUrl.port || "default"}/${database}`;
    const databaseFingerprint = crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 12);
    if (process.env.RUN_DATABASE_TLS_PROBE === "true") {
      const mysql = require("mysql2/promise");
      let strict;
      try {
        const caPath = originalUrl.searchParams.get("sslcert");
        strict = await mysql.createConnection({ host: originalUrl.hostname, port: Number(originalUrl.port || 3306), user: decodeURIComponent(originalUrl.username), password: decodeURIComponent(originalUrl.password), database,
          ssl: { rejectUnauthorized: true, ...(caPath ? { ca: require("node:fs").readFileSync(caPath) } : {}) }, connectTimeout: 10000 });
        await strict.query("SELECT 1");
        console.log(JSON.stringify({ event: "database_strict_tls_probe", ok: true, databaseFingerprint }));
      } catch {
        console.error(JSON.stringify({ event: "database_strict_tls_probe", ok: false, databaseFingerprint, code: "PROVIDER_CA_VERIFICATION_REQUIRED" }));
        throw new Error("PROVIDER_CA_VERIFICATION_REQUIRED");
      } finally { await strict?.end(); }
    }
    const poolParameters = {};
    for (const key of poolKeys) {
      if (originalUrl.searchParams.has(key)) poolParameters[key] = numeric(originalUrl.searchParams.get(key));
    }

    const diagnosticUrl = new URL(originalUrl);
    diagnosticUrl.searchParams.set("connection_limit", "1");
    const { PrismaClient } = require("@prisma/client");
    prisma = new PrismaClient({ log: [], datasources: { db: { url: diagnosticUrl.toString() } } });

    const variables = await prisma.$queryRaw`
      SELECT @@session.wait_timeout AS waitTimeout,
             @@session.interactive_timeout AS interactiveTimeout,
             @@global.max_connections AS maxConnections,
             @@global.max_user_connections AS maxUserConnections
    `;
    const serverVariables = {};
    for (const key of ["waitTimeout", "interactiveTimeout", "maxConnections", "maxUserConnections"]) {
      serverVariables[key] = numeric(variables[0]?.[key]);
    }

    const statuses = await prisma.$queryRaw`
      SHOW GLOBAL STATUS WHERE Variable_name IN (
        'Uptime', 'Threads_connected', 'Threads_running', 'Max_used_connections',
        'Aborted_clients', 'Aborted_connects', 'Connections'
      )
    `;
    const serverStatus = {};
    for (const row of statuses) {
      if (statusKeys.has(row.Variable_name)) serverStatus[row.Variable_name] = numeric(row.Value);
    }

    const counts = {
      reservationTotal: await prisma.reservation.count(),
      hold: await prisma.reservation.count({ where: { status: "HOLD" } }),
      reserved: await prisma.reservation.count({ where: { status: "RESERVED" } }),
      booked: await prisma.reservation.count({ where: { status: "BOOKED" } }),
      receivables: await prisma.financialReceivable.count(),
      payments: await prisma.financialReceivablePayment.count(),
      notifications: await prisma.appNotification.count(),
      proofTotal: await prisma.clientDocument.count({ where: { documentType: "operational_proof_photo" } }),
      proofActive: await prisma.clientDocument.count({ where: { documentType: "operational_proof_photo", status: "active" } }),
      operationTasks: await prisma.operationTask.count()
    };

    const candidate = await prisma.campaign.findFirst({ select: { id: true, clientId: true } });
    let clientFound = false;
    let campaignFound = false;
    let relationshipMatches = false;
    if (candidate) {
      const [client, campaign] = await Promise.all([
        prisma.clientAccount.findUnique({ where: { id: candidate.clientId }, select: { id: true } }),
        prisma.campaign.findUnique({ where: { id: candidate.id }, select: { clientId: true } })
      ]);
      clientFound = Boolean(client);
      campaignFound = Boolean(campaign);
      relationshipMatches = Boolean(client && campaign && campaign.clientId === client.id);
    }
    console.log(JSON.stringify({
      event: "database_diagnostics", ok: true, capturedAt: new Date().toISOString(),
      databaseFingerprint, poolParameters, diagnosticConnectionLimit: 1,
      tlsConfiguration: { verification: ["strict", "accept_invalid_certs"].includes(originalUrl.searchParams.get("sslaccept")) ? originalUrl.searchParams.get("sslaccept") : "driver-default", providerCaConfigured: originalUrl.searchParams.has("sslcert") },
      serverVariables, serverStatus, counts,
      readProbe: { candidateFound: Boolean(candidate), clientFound, campaignFound, relationshipMatches }
    }));
  } catch (error) {
    console.error(JSON.stringify({ event: "database_diagnostics", ok: false, errorCode: safeError(error) }));
    process.exitCode = 1;
  } finally {
    if (prisma) {
      try {
        await prisma.$disconnect();
      } catch (error) {
        console.error(JSON.stringify({ event: "database_diagnostics_disconnect", ok: false, errorCode: safeError(error) }));
        process.exitCode = 1;
      }
    }
  }
}

void main();
