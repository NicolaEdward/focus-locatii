import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getAuthSession } from "@/lib/auth";
import { getCommercialQuotePrint, QuotePrintError } from "@/lib/commercial-quote-print";
import { QuotePrintActions } from "@/components/admin/QuotePrintActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Ofertă comercială · Focus Media", robots: { index: false, follow: false } };
const labels = { approved: "Ofertă validată intern", draft: "Ciornă — necesită validare", expired: "Ofertă expirată", historical: "Versiune istorică", rejected: "Ofertă respinsă" };
const money = (value: string, currency: string) => `${new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))} ${currency}`;
const date = (value: string) => new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "medium" }).format(new Date(value));
const ruleLabels: Record<string, string> = { manual_per_contract: "Conform contractului", campaign_start: "La începutul campaniei", campaign_end: "La finalul campaniei", month_start: "La începutul lunii", month_end: "La sfârșitul lunii", monthly_in_advance: "Lunar, în avans", monthly_after_service: "Lunar, după prestare", upfront_on_contract: "În avans, la semnarea contractului", upfront_before_campaign_start: "În avans, înaintea campaniei", fixed_custom_date: "La data stabilită contractual", monthly: "Lunar", once: "O singură facturare", custom: "Conform calendarului agreat" };

export default async function QuotePrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ revision?: string }> }) {
  const actor = await getAuthSession();
  if (!actor) redirect("/admin/login");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  let document;
  try { document = await getCommercialQuotePrint(id, query.revision, actor); }
  catch (error) {
    if (error instanceof QuotePrintError && [403, 404].includes(error.status)) notFound();
    if (error instanceof QuotePrintError && error.status === 401) redirect("/admin/login");
    if (error instanceof QuotePrintError) return <main className="focus-container py-8"><h1 className="text-2xl font-black">Documentul necesită verificare</h1><p role="alert" className="my-4">{error.message}</p><a className="focus-button secondary" href={`/admin/commercial-quotes?quoteId=${encodeURIComponent(id)}`}>Înapoi la ofertă</a></main>;
    throw error;
  }
  const p = document.payload;
  return <main className="quote-print-shell">
    <style>{`
      .quote-print-shell{background:#e9edf2;color:#152a3a;min-height:100vh;padding:24px;font:14px/1.5 Arial,sans-serif}
      .quote-print-actions{max-width:1000px;margin:0 auto 20px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}.quote-print-actions a,.quote-print-actions button{display:inline-flex;align-items:center;gap:7px;border:1px solid #314957;border-radius:7px;background:white;color:#152a3a;padding:10px 14px;font-weight:700}.quote-print-actions p{width:100%;font-size:12px}
      .quote-print-paper{max-width:1000px;margin:auto;background:white;padding:40px;border-radius:8px;box-shadow:0 4px 18px #12263812;overflow-wrap:anywhere}
      .quote-print-watermark{position:fixed;top:44%;left:12%;right:12%;text-align:center;transform:rotate(-26deg);font-size:64px;font-weight:900;opacity:.08;pointer-events:none;z-index:2}
      .quote-print-header{display:flex;justify-content:space-between;gap:25px;border-bottom:4px solid #ffc400;padding-bottom:22px}.quote-print-header img{width:110px;height:80px;object-fit:contain}.quote-print-header h1{font-size:30px;font-weight:800;line-height:1.2;margin:0 0 10px}.quote-print-status{padding:7px 10px;background:#fff3c5;display:inline-block;font-size:12px;font-weight:700}
      .quote-print-meta{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin:24px 0}.quote-print-meta h2,.quote-print-terms h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#526570;margin:0 0 5px}.quote-print-meta strong{font-size:17px}.quote-print-meta p{margin:4px 0}
      .quote-print-table-wrap{overflow-x:auto}.quote-print-table{width:100%;border-collapse:collapse;font-size:12px}.quote-print-table th{text-align:left;background:#102c3d;color:white;padding:12px 9px}.quote-print-table td{padding:12px 9px;border-bottom:1px solid #dce3e8;vertical-align:top}.quote-print-table .number{text-align:right;white-space:nowrap}.quote-print-total{margin:20px 0 20px auto;max-width:360px}.quote-print-total p{display:flex;justify-content:space-between;gap:20px;margin:7px 0}.quote-print-total strong{font-size:18px}.quote-print-total .final{border-top:2px solid #ffc400;padding-top:10px}
      .quote-print-terms{margin-top:25px;border-top:1px solid #dce3e8;padding-top:20px}.quote-print-terms p{margin:6px 0}.quote-print-terms .notes{white-space:pre-wrap}.quote-print-footer{border-top:1px solid #dce3e8;margin-top:30px;padding-top:15px;font-size:10px;color:#526570}.quote-print-footer code{font-size:9px;overflow-wrap:anywhere}.quote-print-warning{border-left:4px solid #dba600;background:#fff8df;padding:10px 14px;font-size:12px;margin:20px 0}
      @media(max-width:600px){.quote-print-shell{padding:12px}.quote-print-paper{padding:20px 14px}.quote-print-header{gap:12px}.quote-print-header img{width:75px;height:60px}.quote-print-header h1{font-size:24px}.quote-print-meta{grid-template-columns:1fr}.quote-print-table{min-width:650px}}
      @page{size:A4;margin:15mm} @media print{html,body,.quote-print-shell{background:white!important;color:#152a3a!important;padding:0!important;margin:0!important;min-height:0!important}.quote-print-actions{display:none!important}.quote-print-paper{padding:0;max-width:none;border-radius:0;box-shadow:none}.quote-print-table-wrap{overflow:visible}.quote-print-table{min-width:0;font-size:10px}.quote-print-table th,.quote-print-table td{padding:8px 6px}.quote-print-table thead{display:table-header-group}.quote-print-table tr,.quote-print-total,.quote-print-meta{break-inside:avoid}.quote-print-meta{grid-template-columns:1fr 1fr}.quote-print-header img{width:95px;height:65px}.quote-print-header h1{font-size:26px}.quote-print-status,.quote-print-table th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    `}</style>
    <QuotePrintActions quoteId={document.quoteId} />
    <article className="quote-print-paper" aria-label="Oferta comercială pentru tipărire">
      {document.state !== "approved" ? <div aria-hidden="true" className="quote-print-watermark">{document.state === "draft" ? "CIORNĂ" : document.state === "expired" ? "EXPIRATĂ" : document.state === "rejected" ? "RESPINSĂ" : "ISTORIC"}</div> : null}
      <header className="quote-print-header"><div><h1>Ofertă publicitate OOH</h1><span className="quote-print-status">{labels[document.state]}</span><p>{p.companyEntity} · versiunea {document.revision}</p></div><img src="/brand/focus-logo.jpg" alt="Focus Media" /></header>
      <div className="quote-print-meta"><section><h2>Pregătită pentru</h2><strong>{p.clientName}</strong><p>{p.recipient}</p><p>Campanie: {p.campaignName}</p></section><section><h2>Perioada propusă</h2><strong>{date(p.periodStart)} – {date(p.periodEnd)}</strong><p>Prima și ultima zi sunt incluse.</p><p>Valabilitate ofertă: {date(document.expiresAt)}</p><p>Monedă: {p.currency}</p></section></div>
      {document.state !== "approved" ? <p className="quote-print-warning">{document.state === "draft" ? "Această versiune necesită validarea termenilor și aprobarea unui responsabil comercial înainte de transmiterea ca ofertă fermă." : "Document păstrat pentru consultarea istoricului. Pentru o propunere actuală, solicită o versiune nouă."}</p> : null}
      <div className="quote-print-table-wrap"><table className="quote-print-table"><thead><tr><th>Amplasament</th><th className="number">Tarif lunar</th><th className="number">Net pe perioadă</th><th className="number">TVA</th><th className="number">Total pe perioadă</th></tr></thead><tbody>{p.lines.map((line) => <tr key={line.locationId}><td><strong>{line.code}</strong><br />{line.city || ""}</td><td className="number">{money(line.monthlyRate, p.currency)}</td><td className="number">{money(line.net, p.currency)}</td><td className="number">{money(line.tax, p.currency)}</td><td className="number">{money(line.gross, p.currency)}</td></tr>)}</tbody></table></div>
      <section className="quote-print-total" aria-label="Totalul ofertei"><p><span>Total net</span><span>{money(p.totals.net, p.currency)}</span></p><p><span>TVA ({p.vatRateBps / 100}%)</span><span>{money(p.totals.tax, p.currency)}</span></p><p className="final"><strong>Total ofertă</strong><strong>{money(p.totals.gross, p.currency)}</strong></p></section>
      <section className="quote-print-terms"><h2>Condiții comerciale</h2><p>Termen de plată: {p.paymentTermType === "advance" ? "în avans" : p.paymentTermDays == null ? "de confirmat" : `${p.paymentTermDays} zile`}.</p><p>Facturare: {p.billingRule ? ruleLabels[p.billingRule] || "Conform condițiilor din dosarul campaniei" : "de confirmat"}{p.billingFrequency ? ` · ${ruleLabels[p.billingFrequency] || "calendar de confirmat"}` : ""}.</p><p>{p.vatTreatment === "inclusive" ? "Tarifele lunare includ TVA; componentele nete și TVA sunt detaliate mai sus." : p.vatTreatment === "exempt" ? "Tratament TVA scutit, conform politicii comerciale validate." : "Tarifele lunare sunt fără TVA; TVA și totalul de plată sunt detaliate mai sus."}</p>{p.assumptions ? <p className="notes">{p.assumptions}</p> : null}<p>Disponibilitatea amplasamentelor se reconfirmă la rezervare. Oferta nu constituie o rezervare, un contract semnat sau o factură fiscală.</p></section>
      <footer className="quote-print-footer"><p>Ofertă {document.quoteId} · versiunea {document.revision} · creată la {date(document.createdAt)}.</p><p>Referință de verificare: <code>{document.payloadHash}</code></p></footer>
    </article>
  </main>;
}
