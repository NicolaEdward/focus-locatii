import assert from "node:assert/strict";
import { crmWorkspaceInitialState } from "../src/lib/crm-workspace-state";
import { CRM_TIME_ZONE, crmStartOfLocalDay } from "../src/lib/crm-domain";

let checks = 0;
const check = (run: () => void) => { run(); checks++; };
check(() => assert.deepEqual(crmWorkspaceInitialState(), { view: "today", query: "", ownerId: "", status: "", stage: "", due: "all", page: 1, selected: null }));
for (const view of ["today", "prospecting", "opportunities", "all"] as const) check(() => assert.equal(crmWorkspaceInitialState({ view }).view, view));
check(() => assert.equal(crmWorkspaceInitialState({ view: "unknown" }).view, "today"));
const bookmark = "view=opportunities&q=SIM-OOH&owner=sellerA&stage=negotiation&due=upcoming&page=2&kind=opportunity&record=sim-opportunity";
check(() => {
  const clientStyle = crmWorkspaceInitialState(new URLSearchParams(bookmark));
  const serverStyle = crmWorkspaceInitialState(Object.fromEntries(new URLSearchParams(bookmark)));
  assert.deepEqual(serverStyle, clientStyle, "Server-provided initial props must represent the same bookmark as the browser URL.");
  assert.equal(serverStyle.page, 2); assert.equal(serverStyle.query, "SIM-OOH"); assert.equal(serverStyle.stage, "negotiation");
  assert.deepEqual(serverStyle.selected, { kind: "opportunity", id: "sim-opportunity" });
});
check(() => assert.equal(crmWorkspaceInitialState({ view: ["all", "today"], q: ["first", "second"], page: ["3", "1"] }).page, 3));
check(() => assert.equal(crmWorkspaceInitialState({ view: ["all", "today"] }).view, "all"));
for (const page of ["NaN", "Infinity", "-1", "0"]) check(() => assert.equal(crmWorkspaceInitialState({ page }).page, 1));
check(() => assert.equal(crmWorkspaceInitialState({ page: "3.5" }).page, 3));
check(() => assert.equal(crmWorkspaceInitialState({ kind: "user", record: "foreign" }).selected, null));
check(() => assert.equal(crmWorkspaceInitialState({ kind: "opportunity" }).selected, null));
check(() => {
  const nearMidnight = new Date("2026-11-13T22:30:00Z");
  assert.equal(crmStartOfLocalDay(nearMidnight).toISOString(), "2026-11-13T22:00:00.000Z");
  assert.equal(CRM_TIME_ZONE, "Europe/Bucharest");
});
console.log(JSON.stringify({ suite: "crm-workspace-initial-state", checks, passed: checks, databaseConnections: 0 }));
