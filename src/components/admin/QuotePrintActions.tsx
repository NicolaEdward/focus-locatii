"use client";

import Link from "next/link";
import { Printer, ArrowLeft } from "lucide-react";

export function QuotePrintActions({ quoteId }: { quoteId: string }) {
  return <nav className="quote-print-actions" aria-label="Acțiunile documentului"><Link href={`/admin/commercial-quotes?quoteId=${encodeURIComponent(quoteId)}`} prefetch={false}><ArrowLeft size={16} />Înapoi la ofertă</Link><button type="button" onClick={() => window.print()}><Printer size={17} />Tipărește / salvează PDF</button><p>În dialogul de tipărire poți alege „Salvează ca PDF”. Documentul nu este trimis automat.</p></nav>;
}
