import crypto from "node:crypto";
import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";

export const OPERATIONAL_PROOF_STORAGE_PROVIDER = "vercel_blob_private";
const STORAGE_TIMEOUT_MS = 15_000;

export type StoredOperationalProof = {
  provider: typeof OPERATIONAL_PROOF_STORAGE_PROVIDER;
  key: string;
  checksum: string;
  etag: string;
  bytes: number;
  contentType: string;
};

export type OperationalProofObject = {
  stream: ReadableStream<Uint8Array>;
  bytes: number;
  contentType: string;
  etag: string;
};

export function operationalProofStorageEnabled() {
  return process.env.OPERATIONAL_PROOF_STORAGE_ENABLED === "true";
}

export function operationalProofStorageConfigured() {
  const staticToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const oidc = Boolean(process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID);
  return operationalProofStorageEnabled() && (staticToken || oidc);
}

export function assertOperationalProofStorageConfigured() {
  if (!operationalProofStorageEnabled()) {
    throw new Error("Stocarea privata a pozelor dovada nu este activata.");
  }
  if (!operationalProofStorageConfigured()) {
    throw new Error("Stocarea privata a pozelor dovada nu este configurata.");
  }
}

export function operationalProofChecksum(bytes: Uint8Array) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function operationalProofObjectKey(input: {
  reservationId: string;
  fileName: string;
  environment?: string;
}) {
  const environment = safePathSegment(input.environment || process.env.VERCEL_ENV || process.env.APP_ENV || "development");
  const reservation = safePathSegment(input.reservationId);
  const extension = safeExtension(input.fileName);
  return `operational-proof/${environment}/${reservation}/${crypto.randomUUID()}${extension}`;
}

export async function uploadOperationalProofObject(input: {
  reservationId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}): Promise<StoredOperationalProof> {
  assertOperationalProofStorageConfigured();
  const checksum = operationalProofChecksum(input.bytes);
  const key = operationalProofObjectKey(input);
  const blob = await put(key, input.bytes, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: input.contentType,
    cacheControlMaxAge: 60,
    abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS)
  });
  return {
    provider: OPERATIONAL_PROOF_STORAGE_PROVIDER,
    key: blob.pathname,
    checksum,
    etag: blob.etag,
    bytes: input.bytes.byteLength,
    contentType: blob.contentType
  };
}

export async function readOperationalProofObject(key: string): Promise<OperationalProofObject | null> {
  assertOperationalProofStorageConfigured();
  const result = await get(key, { access: "private", useCache: true });
  if (!result || result.statusCode !== 200) return null;
  return {
    stream: result.stream,
    bytes: result.blob.size,
    contentType: result.blob.contentType,
    etag: result.blob.etag
  };
}

export async function deleteOperationalProofObject(key: string, etag?: string | null) {
  assertOperationalProofStorageConfigured();
  try {
    await del(key, { ...(etag ? { ifMatch: etag } : {}) });
  } catch (error) {
    if (error instanceof BlobNotFoundError) return;
    throw error;
  }
}

export async function verifyOperationalProofObject(input: {
  key: string;
  expectedBytes: number;
  expectedChecksum: string;
}) {
  assertOperationalProofStorageConfigured();
  const metadata = await head(input.key);
  if (metadata.size !== input.expectedBytes) return false;
  const result = await get(input.key, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return false;
  const body = Buffer.from(await new Response(result.stream).arrayBuffer());
  return body.byteLength === input.expectedBytes && operationalProofChecksum(body) === input.expectedChecksum;
}

function safePathSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "unknown";
}

function safeExtension(value: string) {
  const match = value.toLowerCase().match(/\.(jpe?g|png|webp)$/);
  return match ? match[0] : "";
}
