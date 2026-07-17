import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  crmEffectiveProbability,
  crmForecastCategoryForStatus,
  crmForecastCategoryLabel,
  crmStatusLabel
} from "@/lib/crm";
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

  const leads = await prisma.crmLead.findMany({
    select: {
      id: true,
      leadDate: true,
      companyName: true,
      taxId: true,
      industry: true,
      opportunityName: true,
      clientType: true,
      contactName: true,
      phone: true,
      email: true,
      source: true,
      status: true,
      estimatedValue: true,
      currency: true,
      probability: true,
      forecastCategory: true,
      expectedCloseDate: true,
      nextFollowUpDate: true,
      nextStep: true,
      locationsInterested: true,
      notes: true,
      lostReason: true,
      lostReasonCode: true,
      lastContactAt: true,
      lastActivityAt: true,
      createdAt: true,
      updatedAt: true,
      assignedTo: { select: { name: true, email: true } },
      client: { select: { id: true, companyName: true, taxId: true } },
      contacts: {
        select: {
          id: true,
          name: true,
          role: true,
          phone: true,
          email: true,
          isPrimary: true,
          notes: true,
          createdAt: true
        },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }]
      },
      activities: {
        select: {
          activityDate: true,
          actionType: true,
          type: true,
          statusAtTime: true,
          details: true,
          note: true,
          nextStep: true,
          nextFollowUpDate: true,
          user: { select: { name: true, email: true } }
        },
        orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }]
      }
    },
    orderBy: [{ companyName: "asc" }, { updatedAt: "desc" }]
  });

  const workbook = XLSX.utils.book_new();
  const leadSheet = XLSX.utils.json_to_sheet(leads.map((lead) => ({
    "Data lead": dateValue(lead.leadDate),
    Companie: lead.companyName,
    "CUI / CIF": lead.taxId || lead.client?.taxId || "",
    "Domeniu activitate": lead.industry || "Neclasificat",
    "Oportunitate / campanie": lead.opportunityName || "",
    "Tip client": lead.clientType || "",
    "Persoana contact principala": lead.contactName || "",
    Telefon: lead.phone || "",
    Email: lead.email || "",
    Sursa: lead.source || "",
    Etapa: crmStatusLabel(lead.status),
    Vanzator: lead.assignedTo?.name || "Nealocat",
    "Email vanzator": lead.assignedTo?.email || "",
    "Valoare oportunitate": lead.estimatedValue ?? "",
    Moneda: lead.currency || "",
    "Sanse de castig (%)": crmEffectiveProbability(lead.probability, lead.status),
    "Nivel forecast": crmForecastCategoryLabel(crmForecastCategoryForStatus(lead.status, lead.probability)),
    "Data estimata inchidere": dateValue(lead.expectedCloseDate),
    "Urmator follow-up": dateValue(lead.nextFollowUpDate),
    "Urmatorul pas": lead.nextStep || "",
    "Interes OOH": lead.locationsInterested || "",
    "Observatii vanzator": lead.notes || "",
    "Motiv pierdere": lead.lostReason || "",
    "Categorie pierdere": lead.lostReasonCode || "",
    "Client inregistrat": lead.client?.companyName || "",
    "Ultimul contact": dateTimeValue(lead.lastContactAt),
    "Ultima activitate": dateTimeValue(lead.lastActivityAt),
    "Creat la": dateTimeValue(lead.createdAt),
    "Actualizat la": dateTimeValue(lead.updatedAt)
  })));

  const contactRows = leads.flatMap((lead) => lead.contacts.map((contact) => ({
    Companie: lead.companyName,
    "CUI / CIF": lead.taxId || lead.client?.taxId || "",
    "Domeniu activitate": lead.industry || "Neclasificat",
    "Oportunitate / campanie": lead.opportunityName || "",
    Vanzator: lead.assignedTo?.name || "Nealocat",
    "Persoana contact": contact.name,
    Rol: contact.role || "",
    Telefon: contact.phone || "",
    Email: contact.email || "",
    Principal: contact.isPrimary ? "Da" : "Nu",
    "Observatii contact": contact.notes || "",
    "Adaugat la": dateTimeValue(contact.createdAt)
  })));
  const contactSheet = XLSX.utils.json_to_sheet(contactRows.length ? contactRows : [{ Mesaj: "Nu exista persoane de contact in CRM." }]);

  const activityRows = leads.flatMap((lead) => lead.activities.map((activity) => ({
    Companie: lead.companyName,
    "CUI / CIF": lead.taxId || lead.client?.taxId || "",
    "Domeniu activitate": lead.industry || "Neclasificat",
    "Oportunitate / campanie": lead.opportunityName || "",
    Vanzator: lead.assignedTo?.name || "Nealocat",
    "Data activitate": dateTimeValue(activity.activityDate),
    Actiune: activity.actionType || activity.type,
    "Etapa la momentul respectiv": activity.statusAtTime ? crmStatusLabel(activity.statusAtTime) : "",
    Detalii: activity.details || "",
    Observatii: activity.note || "",
    "Urmatorul pas": activity.nextStep || "",
    "Urmator follow-up": dateValue(activity.nextFollowUpDate),
    "Inregistrat de": activity.user?.name || activity.user?.email || ""
  })));
  const activitySheet = XLSX.utils.json_to_sheet(activityRows.length ? activityRows : [{ Mesaj: "Nu exista activitati CRM." }]);

  leadSheet["!cols"] = columnWidths([14, 28, 16, 24, 28, 14, 24, 16, 28, 20, 18, 22, 28, 18, 10, 18, 18, 18, 30, 28, 36, 28, 20, 24, 20, 20, 20, 20]);
  contactSheet["!cols"] = columnWidths([28, 16, 24, 28, 22, 24, 20, 16, 28, 10, 36, 20]);
  activitySheet["!cols"] = columnWidths([28, 16, 24, 28, 22, 20, 20, 20, 36, 36, 30, 16, 24]);
  XLSX.utils.book_append_sheet(workbook, leadSheet, "Lead-uri");
  XLSX.utils.book_append_sheet(workbook, contactSheet, "Persoane contact");
  XLSX.utils.book_append_sheet(workbook, activitySheet, "Istoric observatii");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await recordAudit({
    actor: session,
    action: "crm.export",
    entityType: "crm_lead",
    metadata: { leadCount: leads.length, contactCount: contactRows.length, activityCount: activityRows.length },
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

function dateValue(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function dateTimeValue(value: Date | null) {
  return value ? value.toISOString().replace("T", " ").slice(0, 16) : "";
}

function columnWidths(widths: number[]) {
  return widths.map((wch) => ({ wch }));
}
