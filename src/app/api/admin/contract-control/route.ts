import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { ContractControlError, getContractControlReport } from "@/lib/contract-control";
import { contractCsvCell } from "@/lib/contract-control-domain";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["reservations.view", "reservations.view.own"]);
  if (response || !session) return response;
  try {
    const params = new URLSearchParams(request.nextUrl.searchParams), format = params.get("format");
    params.delete("format");
    if (format && format !== "csv") return NextResponse.json({ error: "Format de export neacceptat." }, { status: 400, headers });
    const report = await getContractControlReport(Object.fromEntries(params), session);
    if (format === "csv") {
      // Export exactly the visible page: no hidden cross-portfolio bulk read or
      // unbounded response. Every record carries its verification state.
      const columns = ["Data raportului", "Domeniu", "Cod", "Oraș", "Client", "Campanie", "Contract", "Prima zi inclusă", "Ultima zi inclusă", "Firmă rezervare", "Firmă campanie", "Chirie lunară", "Monedă", "Chirie la data", "Responsabil", "Dovadă", "Probleme", "Următoarea acțiune"];
      const values = report.rows.map((row) => [report.generatedAt, report.portfolioScope, row.locationCode, row.city, row.clientName, row.campaignName, row.contractNumber, row.periodStart, row.periodEnd, row.contractCompany, row.campaignEntity, row.monthlyRent, row.currency, row.priceDate, row.responsible?.name, row.evidence.state, row.issues.join(" | "), row.nextAction]);
      const csv = "\uFEFF" + [columns, ...values].map((row) => row.map(contractCsvCell).join(";")).join("\r\n");
      return new NextResponse(csv, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="control-contractual-${report.businessDate}-pagina-${report.pagination.page}.csv"` } });
    }
    return NextResponse.json(report, { headers });
  } catch (error) {
    if (error instanceof ContractControlError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Filtrele raportului nu sunt valide.", code: "CONTRACT_CONTROL_INPUT_INVALID" }, { status: 400, headers });
    return NextResponse.json({ error: "Raportul contractual nu poate fi încărcat. Datele afișate anterior pot fi vechi.", code: "CONTRACT_CONTROL_UNAVAILABLE" }, { status: 503, headers });
  }
}
