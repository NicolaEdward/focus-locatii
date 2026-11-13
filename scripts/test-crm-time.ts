import assert from "node:assert/strict";
import { crmParseDateInput, crmLocalDateTimeInput, CrmDateInputError } from "../src/lib/crm-time";
import { crmStartOfLocalDay, crmStartOfNextLocalDay, crmStartOfLocalMonth } from "../src/lib/crm-domain";
let checks = 0;
const check = (run: () => void) => { run(); checks++; };
const cases = [
  ["2026-11-16T10:00", "2026-11-16T08:00:00.000Z"],
  ["2027-07-16T10:00", "2027-07-16T07:00:00.000Z"],
  ["2026-11-16T10:00:01.123", "2026-11-16T08:00:01.123Z"],
  ["2026-11-16T10:00:00Z", "2026-11-16T10:00:00.000Z"],
  ["2026-10-25T03:30:00+03:00", "2026-10-25T00:30:00.000Z"],
  ["2026-10-25T03:30:00+02:00", "2026-10-25T01:30:00.000Z"],
  ["2027-03-28T02:59", "2027-03-28T00:59:00.000Z"],
  ["2027-03-28T04:00", "2027-03-28T01:00:00.000Z"],
  ["2026-10-25T02:30", "2026-10-24T23:30:00.000Z"],
  ["2026-10-25T04:30", "2026-10-25T02:30:00.000Z"],
  ["2028-02-29", "2028-02-29T00:00:00.000Z"],
  ["2026-10-25", "2026-10-25T00:00:00.000Z"],
];
for (const [input, expected] of cases) check(() => assert.equal(crmParseDateInput(input).toISOString(), expected));
for (const input of ["2026-02-29", "2027-02-31", "2027-04-31T10:00", "2027-01-01T24:00", "2027-01-01T12:60", "2027-01-01T12:00:60", "2027-01-01T10:00:00+24:00", "2027-01-01T10:00:00+02:60", "16/11/2026 10:00", "", "2026-13-01"]) check(() => assert.throws(() => crmParseDateInput(input), CrmDateInputError));
check(() => assert.throws(() => crmParseDateInput("2027-03-28T03:30"), (error: unknown) => error instanceof CrmDateInputError && error.code === "CRM_TIME_NONEXISTENT"));
check(() => assert.throws(() => crmParseDateInput("2026-10-25T03:30"), (error: unknown) => error instanceof CrmDateInputError && error.code === "CRM_TIME_AMBIGUOUS"));
check(() => assert.equal(crmLocalDateTimeInput(new Date("2026-11-16T08:00:00Z")), "2026-11-16T10:00"));
check(() => assert.equal(crmLocalDateTimeInput(new Date("2027-07-16T07:00:00Z")), "2027-07-16T10:00"));
for (const [date, hours] of [["2027-03-28T12:00:00Z", 23], ["2026-10-25T12:00:00Z", 25], ["2026-11-16T12:00:00Z", 24]] as const) check(() => { const value = new Date(date); assert.equal((crmStartOfNextLocalDay(value).getTime() - crmStartOfLocalDay(value).getTime()) / 3600000, hours); });
check(() => assert.equal(crmStartOfLocalMonth(new Date("2026-11-30T22:30:00Z")).toISOString(), "2026-11-30T22:00:00.000Z"));
check(() => assert.equal(crmStartOfLocalDay(new Date("2026-11-13T22:30:00Z")).toISOString(), "2026-11-13T22:00:00.000Z"));
const oldTimezone = process.env.TZ;
try {
 for (const timezone of ["UTC", "America/New_York", "Asia/Tokyo"]) {
  process.env.TZ = timezone;
  check(() => assert.equal(crmParseDateInput("2026-11-16T10:00").toISOString(), "2026-11-16T08:00:00.000Z"));
  check(() => assert.equal(crmLocalDateTimeInput(new Date("2026-11-16T08:00:00Z")), "2026-11-16T10:00"));
 }
} finally { if (oldTimezone === undefined) delete process.env.TZ; else process.env.TZ = oldTimezone; }
console.log(JSON.stringify({ suite: "crm-bucharest-time", checks, passed: checks, databaseConnections: 0, policy: "Reject unzoned ambiguous/nonexistent times; explicit offsets identify instants; date-only values retain calendar representation." }));
