export type SalesAgendaKind = "invoice" | "follow_up" | "campaign_start" | "campaign_end" | "operation" | "hold";

export type SalesAgendaItem = {
  id: string;
  kind: SalesAgendaKind;
  urgency: "critical" | "high" | "medium" | "normal";
  title: string;
  context: string;
  dueDate: string | null;
  amount: string | null;
  currency: string | null;
  href: string;
  actionLabel: string;
};

/** A debt cannot crowd every overdue call out of the first page merely because
 * of its type. Within one urgency, the actual deadline takes precedence. */
export function sortSalesAgenda(left: SalesAgendaItem, right: SalesAgendaItem) {
  const urgency = { critical: 0, high: 1, medium: 2, normal: 3 };
  return urgency[left.urgency] - urgency[right.urgency]
    || String(left.dueDate || "9999").localeCompare(String(right.dueDate || "9999"))
    || left.id.localeCompare(right.id);
}

export function selectSalesAgenda(items: SalesAgendaItem[], input: {
  kind?: SalesAgendaKind | "all"; query?: string; page?: number; pageSize?: number;
} = {}) {
  const query = (input.query || "").trim().toLocaleLowerCase("ro-RO");
  const filtered = items.filter((item) => (!input.kind || input.kind === "all" || item.kind === input.kind)
    && (!query || `${item.title} ${item.context}`.toLocaleLowerCase("ro-RO").includes(query)));
  const pageSize = Math.max(1, Math.min(50, Math.floor(input.pageSize || 12)));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pages, Math.max(1, Math.floor(input.page || 1)));
  return { rows: filtered.slice((page - 1) * pageSize, page * pageSize), page, pages, total: filtered.length };
}
