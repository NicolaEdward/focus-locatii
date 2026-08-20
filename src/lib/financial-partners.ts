import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { companyEntities, normalizeCompanyEntity } from "@/lib/company-entities";
import { normalizeClientName } from "@/lib/clients";
import { normalizeFiscalCode } from "@/lib/smartbill-import";

type Tx = Prisma.TransactionClient;

export function financialEntityDefinition(companyCode: string) {
  const entity = companyEntities.find((item) => item.code === companyCode);
  if (!entity) throw new Error("Entitatea juridica nu este configurata pentru financiar.");
  return entity;
}

export function detectFinancialEntity(input: { companyCode?: string | null; legalName?: string | null; taxId?: string | null }) {
  if (input.companyCode) return financialEntityDefinition(input.companyCode);
  const taxId = normalizeFiscalCode(input.taxId);
  const byTaxId = companyEntities.find((item) => item.taxId && item.taxId === taxId);
  if (byTaxId) return byTaxId;
  const company = normalizeCompanyEntity(input.legalName);
  const byName = companyEntities.find((item) => item.value === company);
  if (byName) return byName;
  throw new Error("Entitatea juridica nu a putut fi identificata sigur. Selecteaza firma inainte de import.");
}

export async function ensureFinancialLegalEntity(tx: Tx, companyCode: string) {
  const definition = financialEntityDefinition(companyCode);
  return tx.financialLegalEntity.upsert({
    where: { code: definition.code },
    create: {
      code: definition.code,
      legalName: definition.legalName,
      normalizedName: normalizeClientName(definition.legalName),
      taxIdOriginal: definition.taxId ? `RO${definition.taxId}` : null,
      taxIdNormalized: definition.taxId
    },
    update: {
      legalName: definition.legalName,
      normalizedName: normalizeClientName(definition.legalName),
      ...(definition.taxId ? { taxIdNormalized: definition.taxId } : {})
    }
  });
}

export async function ensureFinancialPartner(
  tx: Tx,
  input: { name: string; taxId?: string | null; legalEntityId: string; role: "customer" | "supplier"; clientId?: string | null; supplierId?: string | null }
) {
  const normalizedTaxId = normalizeFiscalCode(input.taxId);
  const normalizedName = normalizeClientName(input.name);
  const identityKey = financialPartnerIdentityKey(input);
  const partner = await tx.financialPartner.upsert({
    where: { identityKey },
    create: {
      identityKey,
      legalName: input.name.trim(),
      normalizedName,
      taxIdOriginal: input.taxId?.trim() || null,
      taxIdNormalized: normalizedTaxId
    },
    update: {
      ...(input.name.trim() ? { legalName: input.name.trim(), normalizedName } : {}),
      ...(input.taxId?.trim() ? { taxIdOriginal: input.taxId.trim(), taxIdNormalized: normalizedTaxId } : {})
    }
  });
  await tx.financialPartnerRole.upsert({
    where: {
      legalEntityId_partnerId_role: {
        legalEntityId: input.legalEntityId,
        partnerId: partner.id,
        role: input.role
      }
    },
    create: {
      legalEntityId: input.legalEntityId,
      partnerId: partner.id,
      role: input.role,
      clientId: input.clientId || null,
      supplierId: input.supplierId || null
    },
    update: {
      active: true,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.supplierId ? { supplierId: input.supplierId } : {})
    }
  });
  return partner;
}

export function financialPartnerIdentityKey(input: {
  name: string;
  taxId?: string | null;
  legalEntityId: string;
  clientId?: string | null;
  supplierId?: string | null;
}) {
  const normalizedTaxId = normalizeFiscalCode(input.taxId);
  if (normalizedTaxId) return `tax:${normalizedTaxId}`;
  if (input.clientId) return `client:${input.clientId}`;
  if (input.supplierId) return `supplier:${input.supplierId}`;
  const normalizedName = normalizeClientName(input.name);
  return `unverified:${input.legalEntityId}:${crypto.createHash("sha256").update(normalizedName).digest("hex")}`;
}

export async function ensureFinancialPartnerAlias(tx: Tx, input: { legalEntityId: string; partnerId: string; alias: string; source: string; actorId?: string | null }) {
  const normalizedAlias = normalizeClientName(input.alias);
  if (!normalizedAlias) return null;
  const aliasKey = partnerAliasKey(input.legalEntityId, normalizedAlias);
  const existing = await tx.financialPartnerAlias.findUnique({ where: { aliasKey }, select: { partnerId: true } });
  if (existing && existing.partnerId !== input.partnerId) {
    throw new Error("Aliasul comerciantului este deja asociat altui partener si necesita verificare manuala.");
  }
  return tx.financialPartnerAlias.upsert({
    where: { aliasKey },
    create: {
      aliasKey,
      legalEntityId: input.legalEntityId,
      partnerId: input.partnerId,
      alias: input.alias.trim(),
      normalizedAlias,
      source: input.source,
      createdByUserId: input.actorId || null
    },
    update: { alias: input.alias.trim(), source: input.source }
  });
}

export function normalizedIban(value?: string | null) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function partnerAliasKey(legalEntityId: string | null, normalizedAlias: string) {
  return crypto.createHash("sha256").update(`${legalEntityId || "global"}:${normalizedAlias}`).digest("hex");
}
