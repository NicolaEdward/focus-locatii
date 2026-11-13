import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { X509Certificate } from "node:crypto";

let cachedCa: { pem: string; file: string } | undefined;
export function databaseConnectionUrl(raw = process.env.DATABASE_URL, caPem = process.env.DATABASE_CA_PEM): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("DATABASE_CONFIGURATION_INVALID"); }
  if (url.protocol !== "mysql:") throw new Error("MYSQL_DATABASE_REQUIRED");
  if (["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) return url.toString();
  // Override the legacy URL flag on every actual remote Prisma connection.
  url.searchParams.set("sslaccept", "strict");
  if (caPem) {
    if (caPem.length > 65536 || caPem.includes("PRIVATE KEY")) throw new Error("DATABASE_CA_INVALID");
    const certificates = caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certificates?.length) throw new Error("DATABASE_CA_INVALID");
    for (const pem of certificates) {
      const cert = new X509Certificate(pem);
      if (!cert.ca || Date.parse(cert.validTo) <= Date.now() || Date.parse(cert.validFrom) > Date.now()) throw new Error("DATABASE_CA_INVALID");
    }
    if (!cachedCa || cachedCa.pem !== caPem) {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), "focus-database-ca-"));
      fs.chmodSync(folder, 0o700);
      const file = path.join(folder, "provider-ca.pem");
      fs.writeFileSync(file, caPem, { flag: "wx", mode: 0o600 });
      cachedCa = { pem: caPem, file };
    }
    url.searchParams.set("sslcert", cachedCa.file);
  } else if (process.env.DATABASE_TLS_CA_FILE) url.searchParams.set("sslcert", process.env.DATABASE_TLS_CA_FILE);
  return url.toString();
}
