/** Shared server/client initial state. Never read window while rendering the first client tree. */
export type CrmWorkspaceView = "today" | "prospecting" | "opportunities" | "all";
export type CrmWorkspaceInitialState = {
  view: CrmWorkspaceView;
  query: string;
  ownerId: string;
  status: string;
  stage: string;
  due: string;
  page: number;
  selected: { kind: "prospect" | "opportunity"; id: string } | null;
};
type Query = URLSearchParams | Record<string, string | string[] | undefined>;

export function crmWorkspaceInitialState(input: Query = {}): CrmWorkspaceInitialState {
  const read = (name: string) => {
    const value = input instanceof URLSearchParams ? input.get(name) : input[name];
    return (Array.isArray(value) ? value[0] : value) || "";
  };
  const candidate = read("view");
  const page = Number(read("page") || 1);
  const kind = read("kind"), record = read("record");
  return {
    view: (["today", "prospecting", "opportunities", "all"].includes(candidate) ? candidate : "today") as CrmWorkspaceView,
    query: read("q"), ownerId: read("owner"), status: read("status"), stage: read("stage"), due: read("due") || "all",
    page: Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1,
    selected: record && (kind === "prospect" || kind === "opportunity") ? { kind, id: record } : null,
  };
}
