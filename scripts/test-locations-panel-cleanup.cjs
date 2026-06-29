const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

main();

function main() {
  adminLocationTableIsScanFirst();
  rowDangerousActionsAreInMenu();
  locationEditorHasPracticalSections();
  publicImpactFieldsHaveWarning();
  privateFieldsStayOutOfOverview();
  galleryPreviewIsPresent();
  numericBlankValuesRemainNull();

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "locations table is scan-first, without inline row editing",
      "delete and duplicate are only inside action menu with confirmations",
      "Export inventar JSON label remains",
      "LocationEditor contains practical section labels",
      "public-impact fields include a warning",
      "raw/private fields are not in Overview",
      "gallery preview and empty state exist",
      "blank numeric values remain null"
    ]
  }, null, 2));
}

function adminLocationTableIsScanFirst() {
  const dashboard = read("src", "components", "admin", "AdminDashboard.tsx");
  const tableBlock = blockFrom(dashboard, '<div id="locatii"', "</table>");
  assert(tableBlock.includes("<Th>Vizibilitate</Th>"), "table should show public/admin visibility summary");
  assert(tableBlock.includes("<Th>Status calculat</Th>"), "table should show computed availability/status label");
  assert(!tableBlock.includes("<Th>GPS</Th>"), "raw GPS column should be removed from first table view");
  assert(!tableBlock.includes("quickPatch("), "table should not perform inline row PATCH edits");
  assert(!tableBlock.includes("<select"), "table should not render inline status editors");
  assert(!tableBlock.includes("defaultValue={location.rateCard"), "table should not render inline rate card editors");
  assert(!tableBlock.includes("latReal?.toFixed"), "real/private coordinates should not render in first table view");
  assert(!dashboard.includes("ToggleMini"), "public toggles should not be direct row controls");
  assert(dashboard.includes("Export inventar JSON"), "developer-ish Backup JSON label should remain renamed");
}

function rowDangerousActionsAreInMenu() {
  const dashboard = read("src", "components", "admin", "AdminDashboard.tsx");
  const actionCell = blockFrom(dashboard, "<LocationActionMenu", "</Td>");
  assert(actionCell.includes("onDuplicate={() => duplicate(location)}"), "duplicate should be routed through action menu");
  assert(actionCell.includes("onDelete={() => remove(location)}"), "delete should be routed through action menu");
  assert(!dashboard.includes('title="Duplicate"'), "duplicate should not be a first-level icon button");
  assert(!dashboard.includes('title="Delete"'), "delete should not be a first-level icon button");
  assert(dashboard.includes("Duplici locatia ${label}?"), "duplicate must require contextual confirmation");
  assert(dashboard.includes("Stergi locatia ${label}?"), "delete must require contextual confirmation");
  assert(dashboard.includes("Se va crea o copie ascunsa din portalul public"), "duplicate confirmation should explain the copy behavior");
}

function locationEditorHasPracticalSections() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  for (const title of [
    "Overview",
    "Comercial",
    "Disponibilitate",
    "Galerie / Poze",
    "Operational",
    "Financiar",
    "Documente / Istoric",
    "Setari avansate"
  ]) {
    assert(editor.includes(`EditorSection title="${title}"`), `LocationEditor should include ${title} section`);
  }
}

function publicImpactFieldsHaveWarning() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  assert(editor.includes("function PublicImpactNotice"), "public-impact warning component should exist");
  assert(editor.includes("Aceasta schimbare afecteaza portalul public"), "public-impact warning text should be visible");
  for (const field of ["showPricePublic", "showInstallationCostPublic", "showInPublic", "latDisplay", "lngDisplay"]) {
    assert(editor.includes(field), `${field} should remain editable in the appropriate section`);
  }
}

function privateFieldsStayOutOfOverview() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  const overview = blockFrom(editor, 'EditorSection title="Overview"', "</EditorSection>");
  for (const privateField of ["latReal", "lngReal", "internalNotes", "monthlyCost", "costNotes", "blockedReason"]) {
    assert(!overview.includes(privateField), `${privateField} should not appear in Overview`);
  }

  const advanced = blockFrom(editor, 'EditorSection title="Setari avansate"', "</EditorSection>");
  assert(advanced.includes('label="latReal"'), "latReal should be moved to advanced settings");
  assert(advanced.includes('label="lngReal"'), "lngReal should be moved to advanced settings");
}

function galleryPreviewIsPresent() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  assert(editor.includes("function GalleryPreview"), "gallery preview helper should exist");
  assert(editor.includes("Nu exista poze pentru aceasta locatie."), "gallery should show an empty state");
  assert(editor.includes("Principala / prima poza"), "gallery should identify the main/first image");
}

function numericBlankValuesRemainNull() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  const numberOrNull = blockFrom(editor, "function numberOrNull", "function dateOrNull");
  assert(numberOrNull.includes("if (!value.trim()) return null;"), "blank optional numeric inputs must not be saved as 0");
}

function blockFrom(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}
