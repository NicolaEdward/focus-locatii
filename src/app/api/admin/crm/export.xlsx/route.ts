import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  crmCurrentOpportunityValue,
  crmForecastForStage,
  crmForecastLabel,
  crmNextActionLabel,
  crmOpportunityStageLabel,
  crmProspectStatusLabel
} from "@/lib/crm-domain";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.view"]);
  if (response || !session) return response;
  if (!["COO", "SUPER_ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Exportul complet CRM este disponibil doar pentru COO." }, { status: 403 });
  }

  const [companies, prospects, opportunities, events] = await Promise.all([
    prisma.crmCompany.findMany({
      select: {
        id: true, name: true, taxId: true, industry: true, website: true, status: true, createdAt: true, updatedAt: true,
        owner: { select: { name: true, email: true } },
        contacts: { select: { name: true, role: true, phone: true, email: true, preferredChannel: true, isDecisionMaker: true, isPrimary: true, createdAt: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }
      },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      take: 20_000
    }),
    prisma.crmProspect.findMany({
      select: {
        id: true, companyId: true, source: true, status: true, priority: true, contactState: true, qualificationSummary: true,
        qualifiedAt: true, disqualifiedAt: true, returnAt: true, closedReason: true, createdAt: true, updatedAt: true,
        company: { select: { name: true, taxId: true, industry: true } }, owner: { select: { name: true, email: true } },
        nextActions: { where: { status: "open" }, select: { type: true, description: true, dueAt: true }, orderBy: { dueAt: "asc" }, take: 1 }
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 25_000
    }),
    prisma.crmOpportunity.findMany({
      select: {
        id: true, companyId: true, sourceProspectId: true, name: true, needSummary: true, stage: true, desiredPeriodStart: true, desiredPeriodEnd: true,
        geography: true, formats: true, budgetStatus: true, budgetMin: true, budgetMax: true, currency: true, quotedValue: true, revisedValue: true,
        agreedValue: true, decisionDate: true, quotedAt: true, negotiationAt: true, contractingAt: true, wonAt: true, lostAt: true,
        lostReasonCode: true, lostReason: true, competitor: true, createdAt: true, updatedAt: true,
        company: { select: { name: true, taxId: true, industry: true } }, owner: { select: { name: true, email: true } },
        nextActions: { where: { status: "open" }, select: { type: true, description: true, dueAt: true }, orderBy: { dueAt: "asc" }, take: 1 }
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 20_000
    }),
    prisma.crmEvent.findMany({
      select: {
        companyId: true, prospectId: true, opportunityId: true, type: true, source: true, summary: true, result: true,
        previousValues: true, nextValues: true, occurredAt: true, actor: { select: { name: true, email: true } }, company: { select: { name: true, taxId: true } }
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 100_000
    })
  ]);

  const workbook = XLSX.utils.book_new();
  const companyRows = companies.map((company) => ({
    "ID firmă CRM": company.id,
    Firmă: company.name,
    CUI: company.taxId || "",
    Domeniu: company.industry || "",
    Website: company.website || "",
    Responsabil: company.owner?.name || "Nealocat",
    "Email responsabil": company.owner?.email || "",
    Status: company.status,
    "Creat la": dateTimeValue(company.createdAt),
    "Actualizat la": dateTimeValue(company.updatedAt)
  }));
  const prospectRows = prospects.map((prospect) => {
    const next = prospect.nextActions[0];
    return {
      "ID prospect": prospect.id,
      Firmă: prospect.company.name,
      CUI: prospect.company.taxId || "",
      Domeniu: prospect.company.industry || "",
      Responsabil: prospect.owner?.name || "Nealocat",
      Sursă: prospect.source || "",
      Status: crmProspectStatusLabel(prospect.status),
      Prioritate: prospect.priority,
      "Stare contact": prospect.contactState,
      "Următoarea acțiune": next ? crmNextActionLabel(next.type, next.description) : "",
      "Termen acțiune": dateTimeValue(next?.dueAt || null),
      "Rezumat calificare": prospect.qualificationSummary ? JSON.stringify(prospect.qualificationSummary) : "",
      "Calificat la": dateTimeValue(prospect.qualifiedAt),
      "Revenire la": dateTimeValue(prospect.returnAt),
      "Motiv închidere": prospect.closedReason || "",
      "Creat la": dateTimeValue(prospect.createdAt),
      "Actualizat la": dateTimeValue(prospect.updatedAt)
    };
  });
  const opportunityRows = opportunities.map((opportunity) => {
    const next = opportunity.nextActions[0];
    const forecast = crmForecastForStage(opportunity.stage);
    return {
      "ID oportunitate": opportunity.id,
      "ID prospect sursă": opportunity.sourceProspectId || "",
      Firmă: opportunity.company.name,
      CUI: opportunity.company.taxId || "",
      Domeniu: opportunity.company.industry || "",
      Oportunitate: opportunity.name,
      "Nevoie comercială": opportunity.needSummary || "",
      Responsabil: opportunity.owner?.name || "Nealocat",
      Etapă: crmOpportunityStageLabel(opportunity.stage),
      "Nivel forecast": crmForecastLabel(forecast),
      "Valoare oportunitate": crmCurrentOpportunityValue(opportunity) ?? "",
      Monedă: opportunity.currency || "",
      "Valoare ofertată": numberValue(opportunity.quotedValue),
      "Valoare revizuită": numberValue(opportunity.revisedValue),
      "Valoare finală agreată": numberValue(opportunity.agreedValue),
      "Data estimată decizie": dateValue(opportunity.decisionDate),
      "Perioadă dorită început": dateValue(opportunity.desiredPeriodStart),
      "Perioadă dorită final": dateValue(opportunity.desiredPeriodEnd),
      Geografie: opportunity.geography || "",
      Formate: opportunity.formats || "",
      "Status buget": opportunity.budgetStatus || "",
      "Buget minim": numberValue(opportunity.budgetMin),
      "Buget maxim": numberValue(opportunity.budgetMax),
      "Următoarea acțiune": next ? crmNextActionLabel(next.type, next.description) : "",
      "Termen acțiune": dateTimeValue(next?.dueAt || null),
      "Motiv pierdere": opportunity.lostReason || "",
      "Categorie pierdere": opportunity.lostReasonCode || "",
      Concurent: opportunity.competitor || "",
      "Câștigat la": dateTimeValue(opportunity.wonAt),
      "Pierdut la": dateTimeValue(opportunity.lostAt),
      "Creat la": dateTimeValue(opportunity.createdAt),
      "Actualizat la": dateTimeValue(opportunity.updatedAt)
    };
  });
  const contactRows = companies.flatMap((company) => company.contacts.map((contact) => ({
    Firmă: company.name,
    CUI: company.taxId || "",
    "Persoană contact": contact.name,
    Funcție: contact.role || "",
    Telefon: contact.phone || "",
    Email: contact.email || "",
    "Canal preferat": contact.preferredChannel || "",
    Decident: contact.isDecisionMaker ? "Da" : "Nu",
    Principal: contact.isPrimary ? "Da" : "Nu",
    "Adăugat la": dateTimeValue(contact.createdAt)
  })));
  const eventRows = events.map((event) => ({
    Firmă: event.company.name,
    CUI: event.company.taxId || "",
    "ID prospect": event.prospectId || "",
    "ID oportunitate": event.opportunityId || "",
    "Data activitate": dateTimeValue(event.occurredAt),
    Tip: event.type,
    Sursă: event.source,
    Rezumat: event.summary,
    Rezultat: event.result || "",
    "Valori vechi": event.previousValues ? JSON.stringify(event.previousValues) : "",
    "Valori noi": event.nextValues ? JSON.stringify(event.nextValues) : "",
    Autor: event.actor?.name || event.actor?.email || "Sistem"
  }));

  appendSheet(workbook, "Firme", companyRows, [26, 16, 22, 26, 22, 28, 16, 18, 18]);
  appendSheet(workbook, "Prospectări", prospectRows, [22, 28, 16, 22, 22, 20, 20, 16, 20, 28, 20, 40, 18, 18, 30, 18, 18]);
  appendSheet(workbook, "Oportunități", opportunityRows, [22, 22, 28, 16, 22, 30, 42, 22, 22, 18, 20, 10, 20, 20, 20, 18, 18, 18, 24, 24, 18, 16, 16, 30, 20, 32, 22, 22, 18, 18, 18, 18]);
  appendSheet(workbook, "Persoane contact", contactRows, [28, 16, 24, 20, 16, 28, 16, 12, 12, 18]);
  appendSheet(workbook, "Istoric audit", eventRows, [28, 16, 22, 22, 20, 24, 18, 45, 45, 45, 45, 24]);

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await recordAudit({
    actor: session,
    action: "crm.v4.export",
    entityType: "crm_domain",
    metadata: { companyCount: companies.length, prospectCount: prospects.length, opportunityCount: opportunities.length, contactCount: contactRows.length, eventCount: events.length },
    request
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="CRM_FocusMedia_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "cache-control": "no-store"
    }
  });
}

function appendSheet(workbook: XLSX.WorkBook, name: string, rows: Record<string, unknown>[], widths: number[]) {
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Mesaj: "Nu există înregistrări." }]);
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}

function numberValue(value: unknown) {
  if (value == null || value === "") return "";
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : "";
}

function dateValue(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function dateTimeValue(value: Date | null) {
  return value ? value.toISOString().replace("T", " ").slice(0, 16) : "";
}
