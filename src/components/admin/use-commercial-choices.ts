"use client";

import { useEffect, useMemo, useState } from "react";

type Choice = { id: string };
type ChoicePage = { page: number; total: number; totalPages: number };

/** Bounded server search; the current selection is hydrated independently of the page. */
export function useCommercialChoices<T extends Choice>(kind: "clients" | "campaigns", initial: T[], selectedId: string,
  q: string, page: number, clientId?: string) {
  const [result, setResult] = useState<{ rows: T[]; selected: T[]; page: ChoicePage } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = window.setTimeout(async () => {
      if (kind === "campaigns" && !clientId) { setResult(null); setLoading(false); return; }
      const params = new URLSearchParams({ kind, q, page: String(page), pageSize: "50" });
      if (selectedId) params.set("ids", selectedId);
      if (clientId) params.set("clientId", clientId);
      try {
        const response = await fetch("/api/admin/commercial-options?" + params, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Opțiunile nu pot fi încărcate.");
        if (!controller.signal.aborted) setResult(body);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Opțiunile nu pot fi încărcate.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [kind, q, page, selectedId, clientId]);
  const rows = useMemo(() => {
    const values = result ? [...result.rows, ...result.selected] : initial;
    return [...new Map(values.map((row) => [row.id, row])).values()];
  }, [result, initial]);
  return { rows, loading, error, page: result?.page };
}
