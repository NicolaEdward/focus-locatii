import { performance } from "node:perf_hooks";

const baseUrl = String(process.env.INVENTORY_MEASURE_BASE_URL || "http://127.0.0.1:3039").replace(/\/$/, "");
const email = process.env.INVENTORY_MEASURE_EMAIL || "coo.preview@focusmedia.test";
const password = process.env.PREVIEW_TEST_PASSWORD || "";

if (!password && process.env.INVENTORY_MEASURE_READ_ONLY_SESSION !== "true") {
  throw new Error("PREVIEW_TEST_PASSWORD is required.");
}

type Run = { status: number; durationMs: number; bytes: number; itemCount: number | null };

async function main() {
  const cookie = process.env.INVENTORY_MEASURE_READ_ONLY_SESSION === "true"
    ? await readOnlySessionCookie()
    : await loginSessionCookie();

  const routes = [
    "/admin/locatii",
    "/api/admin/locations?page=1",
    "/api/admin/reservations?scope=active&page=1",
    "/api/admin/reservation-locations",
    "/api/reservations?view=occupancy-summary",
    "/api/reservations?view=summary",
    "/api/reservations",
    "/api/locations?scope=admin"
  ];
  const results = [];

  for (const route of routes) {
    const runs: Run[] = [];
    for (let index = 0; index < 3; index += 1) {
      const startedAt = performance.now();
      const response = await fetch(`${baseUrl}${route}`, { headers: { cookie }, cache: "no-store" });
      const body = Buffer.from(await response.arrayBuffer());
      runs.push({
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        bytes: body.byteLength,
        itemCount: jsonItemCount(body, response.headers.get("content-type"))
      });
    }
    results.push({
      route,
      medianDurationMs: median(runs.map((run) => run.durationMs)),
      medianBytes: median(runs.map((run) => run.bytes)),
      itemCount: runs.find((run) => run.itemCount != null)?.itemCount ?? null,
      runs
    });
  }

  console.log(JSON.stringify({ ok: true, baseUrl, results }, null, 2));
}

async function loginSessionCookie() {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Session cookie missing.");
  return cookie;
}

async function readOnlySessionCookie() {
  const [{ prisma }, { ADMIN_COOKIE, createSessionToken }] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/auth")
  ]);
  const user = await prisma.user.findFirst({
    where: { active: true, role: { in: ["COO", "SUPER_ADMIN"] } },
    select: { id: true, email: true, name: true, role: true, tokenVersion: true }
  });
  if (!user) throw new Error("No active COO/SUPER_ADMIN user available for read-only measurement.");
  return `${ADMIN_COOKIE}=${createSessionToken(user)}`;
}

function jsonItemCount(body: Buffer, contentType: string | null) {
  if (!contentType?.includes("application/json")) return null;
  try {
    const payload = JSON.parse(body.toString("utf8"));
    if (Array.isArray(payload?.locations?.items)) return payload.locations.items.length;
    if (Array.isArray(payload?.page?.items)) return payload.page.items.length;
    for (const key of ["locations", "reservations", "items"]) {
      if (Array.isArray(payload?.[key])) return payload[key].length;
    }
  } catch {
    return null;
  }
  return null;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
