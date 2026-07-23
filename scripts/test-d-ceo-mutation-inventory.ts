import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import {
  classifyDceoRequest,
  D_CEO_READ_ONLY_GET_EXPORT_ALLOWLIST,
  D_CEO_READ_ONLY_POST_ALLOWLIST,
  dceoBusinessMutationError
} from "../src/lib/business-mutation-policy";

const apiRoot = path.join(process.cwd(), "src", "app", "api");
const routes = routeFiles(apiRoot);
const nonGet: Array<{ method: string; route: string; classification: string }> = [];

for (const file of routes) {
  const source = fs.readFileSync(file, "utf8");
  const route = routePath(file);
  for (const match of source.matchAll(/export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\s*\(/g)) {
    const method = match[1];
    const classification = classifyDceoRequest(method, route);
    nonGet.push({ method, route, classification });
    assert.notEqual(classification, "SAFE_READ", `${method} ${route} cannot be classified as a safe GET.`);
    if (classification === "READ_ONLY_COMPUTATION") {
      assert.equal(method, "POST");
      assert(D_CEO_READ_ONLY_POST_ALLOWLIST.has(route), `${route} is missing from the explicit computation allowlist.`);
      assertNoWriteSignals(source, route);
    } else if (!route.startsWith("/api/auth/")) {
      assert.equal(classification, "BUSINESS_MUTATION", `${method} ${route} must fail closed for D-CEO.`);
    }
  }
}

for (const route of D_CEO_READ_ONLY_POST_ALLOWLIST) {
  assert(nonGet.some((entry) => entry.route === route && entry.method === "POST"), `Allowlisted route does not exist: ${route}`);
}

const authSource = fs.readFileSync(path.join(process.cwd(), "src", "lib", "auth.ts"), "utf8");
assert.match(authSource, /dceoBusinessMutationError\(request, session\.role\)/);
assert.equal((authSource.match(/dceoBusinessMutationError\(request, session\.role\)/g) || []).length, 2);
assert.equal(
  dceoBusinessMutationError(new NextRequest("https://preview.test/api/admin/campaigns", { method: "POST" }), "D_CEO")?.status,
  403,
  "A direct D-CEO business mutation must receive 403."
);
assert.equal(
  dceoBusinessMutationError(new NextRequest("https://preview.test/api/admin/location-selection/availability", { method: "POST" }), "D_CEO"),
  null,
  "An explicitly classified read-only computation remains available."
);
assert.equal(classifyDceoRequest("GET", "/api/admin/availability/excel"), "SAFE_READ");
assert.equal(classifyDceoRequest("GET", "/api/admin/sales-report/excel"), "SAFE_READ");
assert.equal(classifyDceoRequest("GET", "/api/admin/crm/export.xlsx"), "BUSINESS_MUTATION");
assert.equal(classifyDceoRequest("GET", "/api/admin/billing/export"), "BUSINESS_MUTATION");
assert.equal(D_CEO_READ_ONLY_GET_EXPORT_ALLOWLIST.size, 2);

console.log(JSON.stringify({
  ok: true,
  nonGetRoutes: nonGet.length,
  readOnlyComputations: nonGet.filter((entry) => entry.classification === "READ_ONLY_COMPUTATION"),
  accountSecurity: nonGet.filter((entry) => entry.classification === "ACCOUNT_SECURITY").length,
  deniedByDefault: nonGet.filter((entry) => entry.classification === "BUSINESS_MUTATION").length
}, null, 2));

function routeFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? routeFiles(absolute) : entry.name === "route.ts" ? [absolute] : [];
  });
}

function routePath(file: string) {
  return `/${path.relative(path.join(process.cwd(), "src", "app"), path.dirname(file)).split(path.sep).join("/")}`;
}

function assertNoWriteSignals(source: string, route: string) {
  const forbidden = [
    /\.create\s*\(/,
    /\.createMany\s*\(/,
    /\.update\s*\(/,
    /\.updateMany\s*\(/,
    /\.upsert\s*\(/,
    /\.delete\s*\(/,
    /\.deleteMany\s*\(/,
    /\$transaction\s*\(/,
    /recordAudit\s*\(/
  ];
  for (const pattern of forbidden) {
    assert.equal(pattern.test(source), false, `${route} contains a persistence signal: ${pattern}`);
  }
}
