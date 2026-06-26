"use client";

import { AlertTriangle, RefreshCcw } from "lucide-react";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="focus-shell grid min-h-[60vh] place-items-center p-6">
      <section className="max-w-lg rounded-lg border border-red-400/40 bg-red-400/10 p-6 text-center">
        <AlertTriangle className="mx-auto text-red-200" size={32} />
        <h1 className="mt-3 font-display text-3xl font-black uppercase">Datele nu au putut fi incarcate</h1>
        <p className="mt-2 text-sm text-slate-300">Conexiunea a intampinat o problema temporara. Reincearca fara sa pierzi datele introduse.</p>
        <button className="focus-button mx-auto mt-5" type="button" onClick={reset}><RefreshCcw size={18} />Reincearca</button>
      </section>
    </main>
  );
}
