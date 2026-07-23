import assert from "node:assert/strict";
import type { UserRole } from "@prisma/client";
import { ADMIN_COOKIE, createSessionToken } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";

const baseUrl = process.env.DASHBOARD_SMOKE_URL || "http://127.0.0.1:3014";

async function main() {
  const before = await businessCounts();
  const [coo, dCeo, seller, finance] = await Promise.all([
    prisma.user.findFirst({ where: { active: true, role: { in: ["COO", "SUPER_ADMIN"] } }, select: userSelect }),
    prisma.user.findFirst({ where: { active: true, role: "D_CEO" }, select: userSelect }),
    prisma.user.findFirst({ where: { active: true, role: { in: ["SALES_AGENT", "SALES_DIRECTOR"] } }, select: userSelect }),
    prisma.user.findFirst({ where: { active: true, role: "FINANCE_OPERATOR" }, select: userSelect })
  ]);
  assert(coo, "Nu exista utilizator COO/SUPER_ADMIN activ pentru smoke.");
  assert(seller, "Nu exista utilizator Sales activ pentru smoke.");
  const bookedReservation = await prisma.reservation.findFirst({
    where: { status: "BOOKED" },
    select: { id: true, locationId: true, periodStart: true, periodEnd: true },
    orderBy: { periodStart: "desc" }
  });
  assert(bookedReservation, "Nu exista o rezervare BOOKED pentru smoke-ul read-only de disponibilitate.");
  const selectorLocationIds = (await prisma.location.findMany({ select: { id: true }, take: 100 })).map((row) => row.id);

  await waitForServer();
  await timedPage("COO warm-up", "/admin/dashboard", cookieFor(coo), ["Control executiv", "Company Pulse"]);
  const cooResult = await timedPage("COO dashboard", "/admin/dashboard", cookieFor(coo), ["Control executiv", "Executive Alerts preview", "Business Bottlenecks preview"]);
  const dCeoResult = dCeo
    ? await timedPage("D-CEO dashboard", "/admin/dashboard", cookieFor(dCeo), ["D-CEO", "READ-ONLY", "Company Pulse"])
    : null;
  await timedPage("Sales warm-up", "/admin/dashboard", cookieFor(seller), ["Agenda mea"]);
  const salesResult = await timedPage("Sales dashboard", "/admin/dashboard", cookieFor(seller), ["Agenda mea", "Ce am de facut azi", "Scadente clientii mei"]);
  const invoicesResult = await timedPage("Facturi clienti", "/admin/financiar/incasari?status=overdue", cookieFor(coo), ["Facturi clienti", "Scadente"]);
  const filterResult = await timedJson("Filtru financiar", "/api/admin/receivables-workspace?status=overdue&take=10", cookieFor(coo), 200);
  const sellerFinance = await timedJson("Blocare API financiar Sales", "/api/admin/receivables-workspace?status=overdue&take=10", cookieFor(seller), 403);
  const bookedPeriod = {
    periodStart: dateInput(bookedReservation.periodStart),
    periodEnd: dateInput(bookedReservation.periodEnd)
  };
  const availabilityResult = await timedJsonPost(
    "Disponibilitate selector",
    "/api/admin/location-selection/availability",
    cookieFor(coo),
    { locationIds: selectorLocationIds, ...bookedPeriod },
    (payload) => assert.equal(payload?.availabilityByLocationId?.[bookedReservation.locationId]?.state, "CONFLICT", "BOOKED trebuie sa fie indisponibil in selector.")
  );
  const conflictResult = await timedJsonPost(
    "Preview conflict rezervare",
    "/api/admin/reservations/conflict-preview",
    cookieFor(coo),
    { locationIds: [bookedReservation.locationId], ...bookedPeriod },
    (payload) => assert(payload?.conflicts?.some((row: { reservationId?: string; status?: string }) => row.reservationId === bookedReservation.id && row.status === "BOOKED"), "Preview-ul trebuie sa gaseasca rezervarea BOOKED existenta.")
  );

  let financeRedirect: { status: number; location: string | null } | null = null;
  if (finance) {
    const response = await fetch(`${baseUrl}/admin/dashboard`, { headers: { cookie: cookieFor(finance) }, redirect: "manual" });
    financeRedirect = { status: response.status, location: response.headers.get("location") };
    if (response.status === 200) {
      const body = await response.text();
      assert(
        normalize(body).includes("facturi clienti") || body.includes("/admin/financiar/incasari"),
        "Raspunsul streamed pentru Finance trebuie sa contina redirectul catre registrul Facturi clienti."
      );
    } else {
      assert(
        [302, 303, 307, 308].includes(response.status),
        `Dashboardul Finance trebuie sa redirectioneze, dar a raspuns ${response.status} (${financeRedirect.location || "fara Location"}).`
      );
      assert(financeRedirect.location?.includes("/admin/financiar/incasari"), "Finance trebuie redirectionat la Facturi clienti.");
    }
  }

  const after = await businessCounts();
  assert.deepEqual(after, before, "Smoke-ul dashboard a modificat date de business.");
  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    roles: { coo: coo.role, dCeo: dCeo?.role || "missing", sales: seller.role, finance: finance?.role || "missing" },
    timings: [cooResult, dCeoResult, salesResult, invoicesResult, filterResult, availabilityResult, conflictResult, sellerFinance].filter(Boolean),
    financeRedirect,
    databaseBefore: before,
    databaseAfter: after
  }, null, 2));
}

const userSelect = { id: true, email: true, name: true, role: true, tokenVersion: true } as const;

function cookieFor(user: { id: string; email: string; name: string; role: UserRole; tokenVersion: number }) {
  return `${ADMIN_COOKIE}=${createSessionToken(user)}`;
}

async function businessCounts() {
  const [reservations, holds, booked, receivables, payments, notifications, operationTasks, documents] = await Promise.all([
    prisma.reservation.count(),
    prisma.reservation.count({ where: { status: "HOLD" } }),
    prisma.reservation.count({ where: { status: "BOOKED" } }),
    prisma.financialReceivable.count(),
    prisma.financialReceivablePayment.count(),
    prisma.appNotification.count(),
    prisma.operationTask.count(),
    prisma.clientDocument.count()
  ]);
  return { reservations, holds, booked, receivables, payments, notifications, operationTasks, documents };
}

async function timedPage(label: string, pathname: string, cookie: string, expected: string[]) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, { headers: { cookie }, redirect: "manual" });
  const body = await response.text();
  const durationMs = Math.round(performance.now() - started);
  assert.equal(response.status, 200, `${label} a raspuns cu ${response.status}.`);
  for (const expectedText of expected) assert(normalize(body).includes(normalize(expectedText)), `${label} nu contine "${expectedText}".`);
  return { label, durationMs, status: response.status, bytes: Buffer.byteLength(body) };
}

async function timedJson(label: string, pathname: string, cookie: string, expectedStatus: number) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, { headers: { cookie }, redirect: "manual" });
  const body = await response.text();
  const durationMs = Math.round(performance.now() - started);
  assert.equal(response.status, expectedStatus, `${label} a raspuns cu ${response.status}.`);
  return { label, durationMs, status: response.status, bytes: Buffer.byteLength(body) };
}

async function timedJsonPost(label: string, pathname: string, cookie: string, body: unknown, validate: (payload: any) => void) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual"
  });
  const text = await response.text();
  const durationMs = Math.round(performance.now() - started);
  assert.equal(response.status, 200, `${label} a raspuns cu ${response.status}: ${text.slice(0, 300)}`);
  validate(JSON.parse(text));
  return { label, durationMs, status: response.status, bytes: Buffer.byteLength(text) };
}

function dateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

async function waitForServer() {
  const timeoutAt = Date.now() + 30_000;
  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(`${baseUrl}/api/health/db`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Serverul local nu a devenit disponibil in 30 secunde.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
