const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const publicMap = read("src/components/public/LocationMap.tsx");
assert.match(publicMap, /scrollWheelZoom:\s*true/, "Public location map must support mouse-wheel zoom.");
assert.doesNotMatch(publicMap, /scrollWheelZoom:\s*false/, "Public location map must not disable mouse-wheel zoom.");

const escapeHook = read("src/hooks/use-escape-close.tsx");
assert.match(escapeHook, /escapeStack\.at\(-1\)/, "Escape must close only the topmost registered dialog.");
assert.match(escapeHook, /stopImmediatePropagation\(\)/, "Escape must not close several stacked dialogs at once.");
assert.match(escapeHook, /escapeStack\.splice/, "Closed dialogs must be removed from the escape stack.");

const sharedDialogFiles = [
  "src/components/admin/CrmWorkspaceV4.tsx",
  "src/components/admin/client-campaigns/WorkspaceUi.tsx",
  "src/components/admin/ClientCampaignsWorkspace.tsx",
  "src/components/admin/ReceivablesWorkspace.tsx",
  "src/components/admin/AdminReservationsPanel.tsx",
  "src/components/admin/ReservationPeriodChangeDialog.tsx",
  "src/components/admin/inventory/LazyReservationWorkspace.tsx",
  "src/components/admin/FieldWorkInbox.tsx",
  "src/components/admin/FinancialDashboardPanel.tsx",
  "src/components/admin/SalesReportExportButton.tsx",
  "src/components/public/ShortlistDrawer.tsx"
];

for (const file of sharedDialogFiles) {
  assert.match(read(file), /EscapeCloseHandler/, `${file} must use the shared Escape close behavior.`);
}

const componentFiles = walk(path.join(root, "src", "components")).filter((file) => file.endsWith(".tsx"));
for (const absoluteFile of componentFiles) {
  const source = fs.readFileSync(absoluteFile, "utf8");
  if (!source.includes('role="dialog"')) continue;
  const hasEscapeSupport = source.includes("EscapeCloseHandler")
    || /addEventListener\(["']keydown["']/.test(source)
    || /event\.key\s*[!=]==?\s*["']Escape["']/.test(source)
    || source.includes("isEscapeKey(event)");
  assert.ok(hasEscapeSupport, `${path.relative(root, absoluteFile)} exposes a dialog without Escape support.`);
}

const crm = read("src/components/admin/CrmWorkspaceV4.tsx");
assert.match(crm, /aria-label="Dosar CRM">\s*<EscapeCloseHandler onClose=\{onClose\}/, "CRM record drawer must close with Escape.");
assert.match(crm, /function ModalShell[\s\S]*?<EscapeCloseHandler onClose=\{onClose\}/, "CRM create dialogs must close with Escape.");

console.log("Dialog keyboard and public map UX checks passed.");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}
