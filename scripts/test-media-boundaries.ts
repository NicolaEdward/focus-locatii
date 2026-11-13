import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import { passiveImageType, PassiveImageError, PHOTO_MAX_BYTES, PHOTO_TIMEOUT_MS, readLimitedPhoto } from "../src/lib/passive-image";
import { googleDriveFileId } from "../src/lib/photos";
import { isProductionSketchImage } from "../src/lib/location-images";
const require = createRequire(`${process.cwd()}/package.json`);
const id = "auditImage123456789";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function loadRoute(file: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exported: Record<string, (...args: any[]) => Promise<any>> = {};
  runInNewContext(compiled.outputText, { exports: exported, require: (name: string) => name in mocks ? mocks[name] : require(name), Buffer, URL, AbortController, Error, setTimeout, clearTimeout, ...globals });
  return exported;
}

async function main() {
  const sharp = createRequire(require.resolve("next/package.json"))("sharp");
  const optimized = await sharp(png).resize(2, 2).webp().toBuffer();
  assert.equal(passiveImageType(optimized)?.mime, "image/webp", "the patched native image engine processes a benign raster on this platform");
  assert.equal(googleDriveFileId(`https://evil.example/?id=${id}`), null);
  assert.equal(googleDriveFileId(`https://drive.google.com.evil.example/?id=${id}`), null);
  assert.equal(googleDriveFileId(`https://drive.google.com/file/d/${id}/view`), id);
  assert.equal(passiveImageType(Buffer.from("<svg onload='alert(1)'/>")), null);
  assert.equal(passiveImageType(png)?.mime, "image/png");
  let canceled = false;
  const tooLarge = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(PHOTO_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); }, cancel() { canceled = true; } }), { headers: { "Content-Type": "image/png" } });
  await assert.rejects(() => readLimitedPhoto(tooLarge), (e: unknown) => e instanceof PassiveImageError && e.status === 413);
  assert.equal(canceled, true, "an oversized upstream is canceled before buffering the rest");
  const fakeLength = new Response(new Uint8Array(PHOTO_MAX_BYTES + 1), { headers: { "Content-Length": "1", "Content-Type": "image/png" } });
  await assert.rejects(() => readLimitedPhoto(fakeLength), (e: unknown) => e instanceof PassiveImageError && e.status === 413);

  let candidates: any[] = [];
  let loggedIn = false;
  let fetchCalls = 0;
  let responseFactory = (_signal?: AbortSignal) => Promise.resolve(new Response(png, { headers: { "Content-Type": "image/png" } }));
  const proxy = loadRoute("src/app/api/photos/google-drive/[id]/route.ts", {
    "next/server": { NextRequest, NextResponse },
    "@/lib/prisma": { prisma: { location: { findMany: async () => candidates } } },
    "@/lib/photos": { googleDriveFileId },
    "@/lib/auth": { getAuthSessionFromRequest: async () => loggedIn ? { role: "SALES_AGENT" } : null },
    "@/lib/rbac": { hasPermission: () => true },
    "@/lib/location-images": { isProductionSketchImage },
    "@/lib/passive-image": { passiveImageType, PassiveImageError, PHOTO_TIMEOUT_MS, readLimitedPhoto },
    "@/lib/security-rate-limit": { consumeRateLimit: async () => ({ allowed: true }) },
    "@/lib/request-security": { rateLimitIdentity: () => "synthetic-ip" }
  }, { fetch: async (_url: string, init: RequestInit) => { fetchCalls++; return responseFactory(init.signal as AbortSignal); }, setTimeout: (callback: () => void) => setTimeout(callback, 10) });
  const get = () => proxy.GET(new NextRequest(`http://localhost/api/photos/google-drive/${id}`), { params: Promise.resolve({ id }) });
  assert.equal((await get()).status, 404);assert.equal(fetchCalls, 0, "unlinked IDs are never fetched");
  candidates = [{ showInPublic: false, lifecycleStatus: "ACTIVE", mainPhotoUrl: `https://drive.google.com/file/d/${id}/view`, photoOriginalUrl: null, images: [] }];
  assert.equal((await get()).status, 404);assert.equal(fetchCalls, 0, "hidden assets cannot be fetched anonymously");
  loggedIn = true;
  let r = await get();assert.equal(r.status, 200);assert.match(r.headers.get("Cache-Control") || "", /no-store/);assert.equal(r.headers.get("Content-Type"), "image/png");assert.match(r.headers.get("Content-Security-Policy") || "", /sandbox/);
  loggedIn = false;candidates[0].showInPublic = true;
  responseFactory = () => Promise.resolve(new Response("<svg><script>document.title='bad'</script></svg>", { headers: { "Content-Type": "image/svg+xml" } }));
  assert.equal((await get()).status, 415);
  responseFactory = () => Promise.resolve(new Response("<svg onload='bad'/>", { headers: { "Content-Type": "image/png" } }));
  assert.equal((await get()).status, 415, "MIME spoofing must not return active content");
  candidates = [{ showInPublic: true, lifecycleStatus: "ACTIVE", mainPhotoUrl: null, photoOriginalUrl: null, images: [{ url: `https://drive.google.com/file/d/${id}/view`, alt: "PRODUCTION_SKETCH" }] }];
  responseFactory = () => Promise.resolve(new Response(png, { headers: { "Content-Type": "image/png" } }));
  assert.equal((await get()).status, 200, "a deliberately published raster production sketch remains accessible");
  responseFactory = (signal) => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(Object.assign(new Error("synthetic upstream timeout"), { name: "AbortError" }))));
  assert.equal((await get()).status, 504, "the configured upstream deadline aborts the request");

  let storageUrl = "data:application/pdf;base64,JVBERi0xLjQ=";
  let authorized = true;
  const download = loadRoute("src/app/api/admin/client-documents/[id]/route.ts", {
    "next/server": { NextRequest, NextResponse },
    "@/lib/auth": { requireAnyPermission: async () => authorized ? { session: { id: "audit" } } : { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } },
    "@/lib/audit": { recordAudit: async () => {} },
    "@/lib/client-document-access": { evaluateDocumentAccess: () => null, linksFromDocument: () => ({}), resolveDocumentAccess: async () => ({}) },
    "@/lib/prisma": { prisma: { clientDocument: { findUnique: async () => ({ id: "audit-doc", status: "active", storageUrl, fileName: "audit.pdf", fileType: "application/pdf" }) } } }
  });
  const doc = () => download.GET(new NextRequest("http://localhost/api/admin/client-documents/audit-doc"), { params: Promise.resolve({ id: "audit-doc" }) });
  r = await doc();assert.equal(r.status, 200);assert.match(r.headers.get("Cache-Control") || "", /private.*no-store/);
  storageUrl = "https://example.test/synthetic.pdf";r = await doc();assert.equal(r.status, 307);assert.match(r.headers.get("Cache-Control") || "", /no-store/);
  authorized = false;r = await doc();assert.equal(r.status, 401);assert.match(r.headers.get("Cache-Control") || "", /no-store/);
  console.log("Media and document boundaries passed: native raster optimizer, unknown/private IDs, published sketches, SVG, MIME spoofing, real-size limits, timeout and private cache headers.");
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
