import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { OfferRequestDTO } from "@/types/location";
import { parseOfferRequestMeta, stripOfferRequestMeta, withOfferRequestMeta } from "@/lib/offer-request-meta";
import type { AuthSession } from "@/lib/auth";

const crmLeadStatuses = ["NEW", "CONTACTED", "OFFER_SENT", "NEGOTIATION", "RESERVATION_CREATED", "WON", "LOST"] as const;

export const offerRequestInputSchema = z.object({
  clientName: z.string().trim().min(2).max(160),
  company: z.string().trim().max(160).nullable().optional(),
  email: z.string().trim().email().nullable().optional().or(z.literal("")),
  phone: z.string().trim().max(40).nullable().optional(),
  message: z.string().trim().max(4000).nullable().optional(),
  selectedLocationIds: z.array(z.string()).min(1).max(100),
  source: z.string().trim().max(100).nullable().optional()
}).refine((input) => Boolean(String(input.email || "").trim() || String(input.phone || "").trim()), {
  message: "Adauga email sau telefon pentru contact.",
  path: ["email"]
});

export const offerRequestPatchSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "QUOTED", "WON", "LOST", "ARCHIVED"]).optional(),
  salesperson: z.string().trim().max(160).nullable().optional(),
  crmStatus: z.enum(crmLeadStatuses).nullable().optional(),
  estimatedValue: z.preprocess((value) => {
    if (value === "" || value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }, z.number().nonnegative().nullable().optional()),
  nextFollowUpAt: z.preprocess((value) => {
    if (value === "" || value == null) return null;
    const date = parseDate(value);
    return date ? date.toISOString() : null;
  }, z.string().nullable().optional()),
  notes: z.string().trim().max(4000).nullable().optional()
});

export async function createOfferRequest(input: unknown) {
  const parsed = normalizeInput(offerRequestInputSchema.parse(input));
  const locations = await prisma.location.findMany({
    where: {
      id: { in: parsed.selectedLocationIds },
      showInPublic: true
    },
    select: { id: true, code: true }
  });

  if (!locations.length) throw new Error("Selectia nu mai contine locatii publice.");

  const request = await prisma.offerRequest.create({
    data: {
      status: "NEW",
      clientName: parsed.clientName,
      company: parsed.company,
      email: parsed.email || null,
      phone: parsed.phone,
      message: parsed.message,
      selectedLocationIds: locations.map((location) => location.id),
      selectedCodes: locations.map((location) => location.code).join(", "),
      source: parsed.source || "portal-client"
    }
  });

  return serializeOfferRequest(request);
}

export async function listOfferRequests(actor?: AuthSession | null) {
  const requests = await prisma.offerRequest.findMany({
    where: actor?.role === "SALES_AGENT" ? { OR: [{ ownerId: actor.id }, { ownerId: null }] } : undefined,
    orderBy: [{ createdAt: "desc" }],
    take: 200
  });

  const serialized = requests.map(serializeOfferRequest);
  if (actor?.role !== "SALES_AGENT") return serialized;
  return serialized.filter(
    (request) =>
      request.ownerId === actor.id ||
      (request.ownerId == null && (!request.salesperson || [actor.name, actor.email].includes(request.salesperson)))
  );
}

export async function updateOfferRequestStatus(
  id: string,
  status: OfferRequestDTO["status"],
  salesperson?: string | null,
  actor?: AuthSession | null
) {
  const existing = await prisma.offerRequest.findUniqueOrThrow({
    where: { id },
    select: { source: true, ownerId: true }
  });
  assertOfferOwnership(existing, actor);
  const request = await prisma.offerRequest.update({
    where: { id },
    data: {
      status,
      source: withOfferRequestMeta(existing.source, {
        salesperson: actor?.role === "SALES_AGENT" ? actor.name : salesperson || undefined
      }),
      ownerId: actor?.role === "SALES_AGENT" ? actor.id : existing.ownerId
    }
  });

  return serializeOfferRequest(request);
}

export async function updateOfferRequest(id: string, input: unknown, actor?: AuthSession | null) {
  const parsed = offerRequestPatchSchema.parse(input);
  const existing = await prisma.offerRequest.findUniqueOrThrow({
    where: { id },
    select: { source: true, ownerId: true, status: true }
  });
  assertOfferOwnership(existing, actor);
  const currentMeta = parseOfferRequestMeta(existing.source);
  const salesperson = actor?.role === "SALES_AGENT" ? actor.name : parsed.salesperson ?? currentMeta.salesperson;
  const request = await prisma.offerRequest.update({
    where: { id },
    data: {
      ...(parsed.status ? { status: parsed.status } : {}),
      source: withOfferRequestMeta(existing.source, {
        salesperson,
        crmStatus: parsed.crmStatus ?? currentMeta.crmStatus ?? statusToCrmStatus(parsed.status || existing.status),
        estimatedValue: parsed.estimatedValue ?? currentMeta.estimatedValue ?? null,
        nextFollowUpAt: parsed.nextFollowUpAt ?? currentMeta.nextFollowUpAt ?? null,
        notes: parsed.notes ?? currentMeta.notes ?? null,
        lastActivityAt: new Date().toISOString()
      }),
      ownerId: actor?.role === "SALES_AGENT" ? actor.id : existing.ownerId
    }
  });

  return serializeOfferRequest(request);
}

export async function softDeleteOfferRequest(id: string, actor?: AuthSession | null) {
  const existing = await prisma.offerRequest.findUniqueOrThrow({
    where: { id },
    select: { source: true, ownerId: true }
  });
  assertOfferOwnership(existing, actor);
  const request = await prisma.offerRequest.update({
    where: { id },
    data: {
      status: "ARCHIVED",
      source: withOfferRequestMeta(existing.source, {
        deletedAt: new Date().toISOString()
      })
    }
  });

  return serializeOfferRequest(request);
}

function assertOfferOwnership(request: { ownerId: string | null; source: string | null }, actor?: AuthSession | null) {
  if (!actor || actor.role !== "SALES_AGENT") return;
  const salesperson = parseOfferRequestMeta(request.source).salesperson;
  if (request.ownerId && request.ownerId !== actor.id) {
    throw new Error("Solicitarea este deja alocata altui agent.");
  }
  if (!request.ownerId && salesperson && ![actor.name, actor.email].includes(salesperson)) {
    throw new Error("Solicitarea este deja alocata altui agent.");
  }
}

function normalizeInput<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, typeof value === "string" && !value.trim() ? null : value])
  ) as T;
}

function serializeOfferRequest(request: {
  id: string;
  status: string;
  clientName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  selectedLocationIds: unknown;
  selectedCodes: string | null;
  source: string | null;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OfferRequestDTO {
  const meta = parseOfferRequestMeta(request.source);
  return {
    id: request.id,
    status: request.status as OfferRequestDTO["status"],
    clientName: request.clientName,
    company: request.company,
    email: request.email,
    phone: request.phone,
    message: request.message,
    selectedLocationIds: Array.isArray(request.selectedLocationIds)
      ? request.selectedLocationIds.map(String)
      : [],
    selectedCodes: request.selectedCodes,
    source: stripOfferRequestMeta(request.source),
    salesperson: meta.salesperson || null,
    crmStatus: normalizeCrmStatus(meta.crmStatus) || statusToCrmStatus(request.status),
    estimatedValue: meta.estimatedValue ?? null,
    nextFollowUpAt: meta.nextFollowUpAt || null,
    internalNotes: meta.notes || null,
    lastActivityAt: meta.lastActivityAt || request.updatedAt.toISOString(),
    deletedAt: meta.deletedAt || null,
    ownerId: request.ownerId,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString()
  };
}

function statusToCrmStatus(status: string): OfferRequestDTO["crmStatus"] {
  if (status === "CONTACTED") return "CONTACTED";
  if (status === "QUOTED") return "OFFER_SENT";
  if (status === "WON") return "WON";
  if (status === "LOST" || status === "ARCHIVED") return "LOST";
  return "NEW";
}

function normalizeCrmStatus(value?: string | null): OfferRequestDTO["crmStatus"] | null {
  return crmLeadStatuses.includes(value as never) ? value as OfferRequestDTO["crmStatus"] : null;
}

function parseDate(value: unknown) {
  if (!value) return null;
  const text = String(value);
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const date = new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])));
    return date.toISOString().slice(0, 10) === text ? date : null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
