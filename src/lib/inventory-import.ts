import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { securityHash, secureEqual } from "@/lib/security-secrets";
import { createLocationInTransaction, updateLocationInTransaction, normalizeLocationData, withoutLegacyAvailabilityState } from "@/lib/location-mutations";
import { isProductionSketchImage } from "@/lib/location-images";
import { locationInputSchema, locationPatchSchema } from "@/lib/validation";
import type { ImportSummary } from "@/types/location";

// Bounded atomic batches avoid a 25,000-row transaction with an unknown partial result.
export const MAX_ATOMIC_INVENTORY_ROWS = 250;
export const INVENTORY_PREVIEW_SECONDS = 10 * 60;
export const INVENTORY_MANAGED_FIELDS = [
  "showInPublic", "showPricePublic", "showInstallationCostPublic", "isFeatured", "isPremium",
  "latReal", "lngReal", "latDisplay", "lngDisplay", "mapsUrl", "coordinateSource", "gpsAuditStatus",
  "internalNotes", "productionSketchUrl", "imageUrls"
] as const;

export type InventoryImportActor = { id: string; email: string };
export type InventoryImportOptions = { publishNewLocations: boolean; overrideManagedFields: boolean };
export type InventoryImportRow = { code: string; categoryName: string; data: Record<string, unknown>; mainImage?: string | null };
type Baseline = { code: string; id: string | null; updatedAt: string | null; fingerprint: string | null };
type PreviewToken = { v: 1; actorId: string; payloadHash: string; baselineHash: string; options: InventoryImportOptions; expiresAt: number; nonce: string };

export class InventoryImportError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function inventoryOptions(value: unknown): InventoryImportOptions {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { publishNewLocations: input.publishNewLocations === true, overrideManagedFields: input.overrideManagedFields === true };
}

export function inventoryPayloadHash(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
export function inventoryIntentId(previewToken: string) { return `inventory-${inventoryPayloadHash(previewToken).slice(0, 40)}`; }

export function validateInventoryRows(rows: InventoryImportRow[]) {
  if (!rows.length) throw new InventoryImportError("Importul nu conține locații valide.");
  if (rows.length > MAX_ATOMIC_INVENTORY_ROWS) throw new InventoryImportError(`Importul atomic este limitat la ${MAX_ATOMIC_INVENTORY_ROWS} de locații. Împarte fișierul în loturi mai mici.`, 413);
  const codes = new Set<string>();
  for (const row of rows) {
    if (!row.code || codes.has(row.code)) throw new InventoryImportError("Importul conține un cod lipsă sau duplicat.");
    codes.add(row.code);
    // Full validation occurs before any write; defaults are applied only on CREATE.
    const result = locationInputSchema.safeParse({ ...row.data, code: row.code, categoryName: row.categoryName });
    if (!result.success) throw new InventoryImportError(`Locația ${row.code}: valori invalide în câmpurile ${result.error.issues.slice(0, 5).map((issue) => issue.path.join(".")).join(", ")}.`);
  }
}

function normalizedData(row: InventoryImportRow, existing: boolean, options: InventoryImportOptions) {
  const data: Record<string, unknown> = { ...row.data, code: row.code, categoryName: row.categoryName };
  if (existing && !options.overrideManagedFields) for (const field of INVENTORY_MANAGED_FIELDS) delete data[field];
  if (!existing) {
    data.showInPublic = options.publishNewLocations;
    // Publishing commercial fields requires an explicit edit after import.
    data.showPricePublic = false;
    data.showInstallationCostPublic = false;
  }
  const parsed = existing ? locationPatchSchema.parse(data) : locationInputSchema.parse(data);
  // Preview and apply share normalization and ignore the same legacy state.
  // categoryName is excluded from normalizeLocationData in location mutations.
  const { categoryName, ...fields } = withoutLegacyAvailabilityState(parsed);
  return {
    ...normalizeLocationData(fields), categoryName,
    ...(!existing ? { latDisplay: parsed.latDisplay ?? parsed.latReal, lngDisplay: parsed.lngDisplay ?? parsed.lngReal } : {})
  };
}

function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

async function baseline(rows: InventoryImportRow[], db: Pick<typeof prisma, "location"> = prisma) {
  const existing = await db.location.findMany({ where: { code: { in: rows.map((row) => row.code) } }, include: { category: { select: { name: true } }, images: true } });
  const byCode = new Map(existing.map((row) => [row.code, row]));
  const versions: Baseline[] = rows.map((row) => {
    const value = byCode.get(row.code);
    // A timestamp alone can repeat within the same millisecond or be bypassed
    // by a legacy SQL writer. Include the state and gallery that were reviewed.
    return { code: row.code, id: value?.id || null, updatedAt: value?.updatedAt.toISOString() || null,
      fingerprint: value ? inventoryPayloadHash(stable({ ...value, images: [...value.images].sort((a, b) => a.id.localeCompare(b.id)) })) : null };
  }).sort((a, b) => a.code.localeCompare(b.code));
  return { byCode, hash: inventoryPayloadHash(stable(versions)) };
}

function signToken(token: PreviewToken) {
  const encoded = Buffer.from(JSON.stringify(token)).toString("base64url");
  return `${encoded}.${securityHash("inventory-preview-v1", encoded)}`;
}

function verifyToken(value: string, actor: InventoryImportActor, payloadHash: string, options: InventoryImportOptions): PreviewToken {
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra || value.length > 4096 || !secureEqual(securityHash("inventory-preview-v1", encoded), signature)) throw new InventoryImportError("Preview-ul importului nu este valid. Generează unul nou.", 409);
  let token: PreviewToken;
  try { token = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw new InventoryImportError("Preview invalid.", 409); }
  if (token.v !== 1 || token.actorId !== actor.id || token.payloadHash !== payloadHash || stable(token.options) !== stable(options) || !Number.isFinite(token.expiresAt) || !token.nonce) {
    throw new InventoryImportError("Fișierul, opțiunile sau sesiunea s-au schimbat ori preview-ul a expirat. Verifică din nou diferențele.", 409);
  }
  return token;
}

export async function previewInventoryImport(input: { rows: InventoryImportRow[]; payloadHash: string; actor: InventoryImportActor; options: InventoryImportOptions }) {
  validateInventoryRows(input.rows);
  const state = await baseline(input.rows);
  const rows = input.rows.map((row) => {
    const current = state.byCode.get(row.code);
    const data = normalizedData(row, Boolean(current), input.options) as Record<string, unknown>;
    const before = (field: string) => {
      if (!current) return null;
      if (field === "categoryName") return current.category.name;
      if (field === "imageUrls") return current.images.filter((image) => !isProductionSketchImage(image)).map((image) => image.url);
      if (field === "productionSketchUrl") return current.images.find(isProductionSketchImage)?.url ?? null;
      return (current as Record<string, unknown>)[field] ?? null;
    };
    const changes = Object.entries(data).filter(([key, next]) => stable(before(key)) !== stable(next ?? null))
      .map(([field, next]) => ({ field, before: before(field), after: next ?? null }));
    return { code: row.code, action: current ? "update" : "create", changes, preservedFields: current && !input.options.overrideManagedFields ? INVENTORY_MANAGED_FIELDS : [] };
  });
  const expiresAt = Date.now() + INVENTORY_PREVIEW_SECONDS * 1000;
  const previewToken = signToken({ v: 1, actorId: input.actor.id, payloadHash: input.payloadHash, baselineHash: state.hash, options: input.options, expiresAt, nonce: randomUUID() });
  return {
    totalRows: rows.length, createdCount: rows.filter((row) => row.action === "create").length, updatedCount: rows.filter((row) => row.action === "update").length,
    rows, options: input.options, expiresAt: new Date(expiresAt).toISOString(),
    previewToken, intentId: inventoryIntentId(previewToken)
  };
}

export async function confirmInventoryImport(input: { rows: InventoryImportRow[]; payloadHash: string; fileName: string; actor: InventoryImportActor; options: InventoryImportOptions; previewToken: string }): Promise<ImportSummary> {
  validateInventoryRows(input.rows);
  const token = verifyToken(input.previewToken, input.actor, input.payloadHash, input.options);
  const batchId = inventoryIntentId(input.previewToken);
  const previous = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (previous) return summary(previous);
  // Expired previews cannot start a write, but a previously committed result
  // remains recoverable for the same authenticated, signed intent.
  if (token.expiresAt <= Date.now()) throw new InventoryImportError("Preview-ul a expirat. Generează unul nou înainte de aplicare.", 409);
  try {
    return await prisma.$transaction(async (tx) => {
      // Unique deterministic ID serializes retries of the same reviewed intent.
      await tx.importBatch.create({ data: { id: batchId, fileName: input.fileName.slice(0, 191), importedBy: input.actor.email, notes: "inventory-preview-v1; atomic; completed only if transaction commits" } });
      const codes = input.rows.map((row) => row.code).sort();
      await tx.$queryRaw(Prisma.sql`SELECT id FROM portfolio_locations WHERE code IN (${Prisma.join(codes)}) ORDER BY id FOR UPDATE`);
      const state = await baseline(input.rows, tx);
      if (state.hash !== token.baselineHash) throw new InventoryImportError("Inventarul s-a schimbat după preview. Nicio locație nu a fost modificată; generează un preview nou.", 409);
      let createdCount = 0, updatedCount = 0, missingGpsCount = 0, suspectGpsCount = 0, okGpsCount = 0;
      const auditChanges: Array<Record<string, unknown>> = [];
      for (const row of input.rows) {
        const existing = state.byCode.get(row.code);
        const data = normalizedData(row, Boolean(existing), input.options);
        const location = existing ? await updateLocationInTransaction(tx, existing.id, data) : await createLocationInTransaction(tx, data);
        auditChanges.push({ code: row.code, before: existing ? { showInPublic: existing.showInPublic, showPricePublic: existing.showPricePublic, showInstallationCostPublic: existing.showInstallationCostPublic } : null, after: { showInPublic: location.showInPublic, showPricePublic: location.showPricePublic, showInstallationCostPublic: location.showInstallationCostPublic }, protectedFieldsOverridden: input.options.overrideManagedFields });
        if (existing) updatedCount++; else createdCount++;
        if (location.gpsAuditStatus === "MISSING") missingGpsCount++;
        else if (location.gpsAuditStatus === "SUSPECT") suspectGpsCount++;
        else okGpsCount++;
        if (row.mainImage) await tx.image.upsert({ where: { id: `${location.id}-main` }, update: { url: row.mainImage, alt: `${row.code} photo`, isMain: true }, create: { id: `${location.id}-main`, locationId: location.id, url: row.mainImage, alt: `${row.code} photo`, isMain: true, sortOrder: 0 } });
      }
      const result = await tx.importBatch.update({ where: { id: batchId }, data: { totalRows: input.rows.length, createdCount, updatedCount, missingGpsCount, suspectGpsCount, okGpsCount } });
      await tx.auditLog.create({ data: { userId: input.actor.id, action: "locations.import_confirm", entityType: "import_batch", entityId: batchId, metadata: JSON.parse(JSON.stringify({ durability: "business-transaction", payloadHash: input.payloadHash, options: input.options, totalRows: input.rows.length, changes: auditChanges })) } });
      return summary(result);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 60_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const committed = await prisma.importBatch.findUnique({ where: { id: batchId } });
      if (committed) return summary(committed);
      throw new InventoryImportError("Un import concurent a creat unul dintre coduri. Nicio modificare parțială; generează un preview nou.", 409);
    }
    throw error;
  }
}

function summary(batch: { id: string; totalRows: number; createdCount: number; updatedCount: number; missingGpsCount: number; suspectGpsCount: number; okGpsCount: number }): ImportSummary {
  const { id, ...values } = batch;
  return { batchId: id, totalRows: values.totalRows, createdCount: values.createdCount, updatedCount: values.updatedCount, missingGpsCount: values.missingGpsCount, suspectGpsCount: values.suspectGpsCount, okGpsCount: values.okGpsCount };
}
