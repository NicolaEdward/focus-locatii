async function main() {
  const baseUrl = String(process.env.MEASURE_BASE_URL || "http://127.0.0.1:3011").replace(/\/$/, "");
  const password = process.env.PREVIEW_TEST_PASSWORD;
  if (!password) throw new Error("PREVIEW_TEST_PASSWORD lipsește.");

  const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "finance.preview@focusmedia.test", password })
  });
  if (!login.ok) throw new Error(`Login eșuat: ${login.status}`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Cookie-ul sesiunii lipsește.");

  const routes = [
  "/admin/financiar/incasari",
  "/api/admin/receivables-workspace/registry?take=40",
  "/api/admin/receivables-workspace/registry?take=40&view=history",
  "/api/admin/receivables-workspace/payments?take=40"
  ];
  const results = [];
  for (const route of routes) {
    for (let run = 1; run <= 3; run += 1) {
      const startedAt = Date.now();
      const response = await fetch(`${baseUrl}${route}`, { headers: { cookie }, redirect: "manual" });
      const body = await response.text();
      results.push({ route, run, durationMs: Date.now() - startedAt, bytes: Buffer.byteLength(body), status: response.status });
    }
  }
  console.log(JSON.stringify({ baseUrl, results }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
