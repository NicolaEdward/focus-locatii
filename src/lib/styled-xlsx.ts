import { deflateRawSync } from "zlib";
import CRC32 from "crc-32";

type CellValue = string | number | boolean | null | undefined;

export type StyledCell = {
  value: CellValue;
  style?: number;
  hyperlink?: string;
};

export type StyledSheet = {
  name: string;
  rows: Array<Array<StyledCell | CellValue>>;
  merges?: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  columns?: Array<{ width: number }>;
  freezeRows?: number;
  autoFilter?: { startRow: number; startCol: number; endRow: number; endCol: number };
};

type ZipEntry = {
  path: string;
  content: Buffer;
};

const MIME_MAIN = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const MIME_SHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const MIME_STYLES = "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml";
const MIME_RELS = "application/vnd.openxmlformats-package.relationships+xml";
const MIME_XML = "application/xml";

export const XLSX_STYLES = {
  title: 1,
  header: 2,
  body: 3,
  bodyAlt: 4,
  hyperlink: 5,
  availabilityAvailable: 6,
  availabilityBooked: 7,
  availabilityReserved: 8,
  centered: 9
} as const;

export function createStyledWorkbook(sheets: StyledSheet[]) {
  const safeSheets = sheets.length
    ? sheets.map((sheet, index) => ({
        ...sheet,
        name: safeSheetName(sheet.name, index + 1)
      }))
    : [
        {
          name: "Disponibil",
          rows: [[{ value: "Nu exista date pentru export.", style: XLSX_STYLES.title }]]
        }
      ];

  const entries: ZipEntry[] = [
    file("[Content_Types].xml", contentTypesXml(safeSheets.length)),
    file("_rels/.rels", rootRelsXml()),
    file("xl/workbook.xml", workbookXml(safeSheets)),
    file("xl/_rels/workbook.xml.rels", workbookRelsXml(safeSheets.length)),
    file("xl/styles.xml", stylesXml())
  ];

  safeSheets.forEach((sheet, index) => {
    const sheetNumber = index + 1;
    const sheetXml = worksheetXml(sheet, sheetNumber);
    entries.push(file(`xl/worksheets/sheet${sheetNumber}.xml`, sheetXml.xml));
    if (sheetXml.relationships.length) {
      entries.push(file(`xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`, sheetRelsXml(sheetXml.relationships)));
    }
  });

  return zip(entries);
}

function worksheetXml(sheet: StyledSheet, sheetNumber: number) {
  const relationships: Array<{ id: string; target: string }> = [];
  const maxRow = Math.max(sheet.rows.length, 1);
  const maxCol = Math.max(...sheet.rows.map((row) => row.length), 1);
  const dimension = `A1:${columnName(maxCol)}${maxRow}`;
  const columns = sheet.columns?.length ? colsXml(sheet.columns) : "";
  const freeze = sheet.freezeRows ? freezePaneXml(sheet.freezeRows) : "";
  const mergeXml = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
        .map((merge) => `<mergeCell ref="${rangeRef(merge.startRow, merge.startCol, merge.endRow, merge.endCol)}"/>`)
        .join("")}</mergeCells>`
    : "";
  const autoFilter = sheet.autoFilter ? `<autoFilter ref="${rangeRef(sheet.autoFilter.startRow, sheet.autoFilter.startCol, sheet.autoFilter.endRow, sheet.autoFilter.endCol)}"/>` : "";
  const hyperlinkRefs: string[] = [];

  const rowsXml = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((rawCell, cellIndex) => {
          const cell = normalizeCell(rawCell);
          const ref = `${columnName(cellIndex + 1)}${rowIndex + 1}`;
          if (cell.hyperlink) {
            const relationshipId = `rId${relationships.length + 1}`;
            relationships.push({ id: relationshipId, target: cell.hyperlink });
            hyperlinkRefs.push(`<hyperlink ref="${ref}" r:id="${relationshipId}"/>`);
          }
          return cellXml(ref, cell);
        })
        .join("");
      return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="30" customHeight="1"' : ""}>${cells}</row>`;
    })
    .join("");

  const hyperlinks = hyperlinkRefs.length ? `<hyperlinks>${hyperlinkRefs.join("")}</hyperlinks>` : "";

  return {
    relationships,
    xml: xmlDeclaration(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <dimension ref="${dimension}"/>
        <sheetViews>${freeze || '<sheetView workbookViewId="0"/>'}</sheetViews>
        <sheetFormatPr defaultRowHeight="18"/>
        ${columns}
        <sheetData>${rowsXml}</sheetData>
        ${autoFilter}
        ${mergeXml}
        ${hyperlinks}
        <pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
      </worksheet>`
    )
  };
}

function cellXml(ref: string, cell: StyledCell) {
  const style = cell.style != null ? ` s="${cell.style}"` : "";
  if (cell.value == null || cell.value === "") return `<c r="${ref}"${style}/>`;
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) return `<c r="${ref}"${style}><v>${cell.value}</v></c>`;
  if (typeof cell.value === "boolean") return `<c r="${ref}" t="b"${style}><v>${cell.value ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(String(cell.value))}</t></is></c>`;
}

function normalizeCell(rawCell: StyledCell | CellValue): StyledCell {
  if (rawCell && typeof rawCell === "object" && "value" in rawCell) return rawCell;
  return { value: rawCell };
}

function colsXml(columns: Array<{ width: number }>) {
  return `<cols>${columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`)
    .join("")}</cols>`;
}

function freezePaneXml(freezeRows: number) {
  return `<sheetView workbookViewId="0"><pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView>`;
}

function stylesXml() {
  return xmlDeclaration(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <fonts count="6">
      <font><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/></font>
      <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
      <font><b/><sz val="11"/><color rgb="FF07131F"/><name val="Calibri"/></font>
      <font><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
      <font><u/><sz val="10"/><color rgb="FF0563C1"/><name val="Calibri"/></font>
      <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    </fonts>
    <fills count="9">
      <fill><patternFill patternType="none"/></fill>
      <fill><patternFill patternType="gray125"/></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FF07131F"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FFFFB800"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FFF7FAFC"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FFE8F8EE"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FFFFEFE7"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FFFFF8DD"/><bgColor indexed="64"/></patternFill></fill>
    </fills>
    <borders count="2">
      <border><left/><right/><top/><bottom/><diagonal/></border>
      <border>
        <left style="thin"><color rgb="FFE2E8F0"/></left>
        <right style="thin"><color rgb="FFE2E8F0"/></right>
        <top style="thin"><color rgb="FFE2E8F0"/></top>
        <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
        <diagonal/>
      </border>
    </borders>
    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    <cellXfs count="10">
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
      <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
      <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
      <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
      <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
      <xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="top"/></xf>
      <xf numFmtId="0" fontId="3" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
      <xf numFmtId="0" fontId="3" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
      <xf numFmtId="0" fontId="3" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
      <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="top"/></xf>
    </cellXfs>
    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    <dxfs count="0"/>
    <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
  </styleSheet>`);
}

function contentTypesXml(sheetCount: number) {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="${MIME_SHEET}"/>`
  ).join("");

  return xmlDeclaration(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="${MIME_RELS}"/>
    <Default Extension="xml" ContentType="${MIME_XML}"/>
    <Override PartName="/xl/workbook.xml" ContentType="${MIME_MAIN}"/>
    <Override PartName="/xl/styles.xml" ContentType="${MIME_STYLES}"/>
    ${sheetOverrides}
  </Types>`);
}

function rootRelsXml() {
  return xmlDeclaration(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  </Relationships>`);
}

function workbookXml(sheets: Array<{ name: string }>) {
  return xmlDeclaration(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
  </workbook>`);
}

function workbookRelsXml(sheetCount: number) {
  const sheetRels = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");
  return xmlDeclaration(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    ${sheetRels}
    <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  </Relationships>`);
}

function sheetRelsXml(relationships: Array<{ id: string; target: string }>) {
  return xmlDeclaration(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    ${relationships
      .map(
        (relationship) =>
          `<Relationship Id="${relationship.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(relationship.target)}" TargetMode="External"/>`
      )
      .join("")}
  </Relationships>`);
}

function zip(entries: ZipEntry[]) {
  const fileParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const compressed = deflateRawSync(entry.content);
    const crc = CRC32.buf(entry.content) >>> 0;
    const time = dosTime(new Date());
    const date = dosDate(new Date());
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    fileParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...fileParts, centralDirectory, end]);
}

function file(path: string, xml: string): ZipEntry {
  return { path, content: Buffer.from(xml, "utf8") };
}

function columnName(index: number) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function rangeRef(startRow: number, startCol: number, endRow: number, endCol: number) {
  return `${columnName(startCol)}${startRow}:${columnName(endCol)}${endRow}`;
}

function safeSheetName(value: string, fallback: number) {
  return (value || `Sheet ${fallback}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || `Sheet ${fallback}`;
}

function xmlDeclaration(value: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value.replace(/>\s+</g, "><").trim()}`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function dosTime(date: Date) {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function dosDate(date: Date) {
  return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}
