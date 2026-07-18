import { Worker } from "node:worker_threads";

export const SPREADSHEET_LIMITS = {
  maxCompressedBytes: 20 * 1024 * 1024,
  maxUncompressedBytes: 80 * 1024 * 1024,
  maxSingleEntryBytes: 32 * 1024 * 1024,
  maxZipEntries: 2048,
  maxSheets: 32,
  maxRowsPerSheet: 25_000,
  maxColumnsPerSheet: 128,
  maxCells: 500_000,
  maxCellTextLength: 32_767,
  parseTimeoutMs: 12_000
} as const;

const SAFE_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const SAFE_SHEET_NAME = /^[^\u0000-\u001f\u007f\\/?*[\]:]{1,31}$/u;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type SpreadsheetPurpose = "inventory" | "receivables" | "financial" | "smartbill" | "test";
export type SpreadsheetCell = string | number | boolean | Date | null;

export type SafeSpreadsheetSheet = {
  name: string;
  rows: SpreadsheetCell[][];
  hyperlinks: Record<string, string>;
  rowCount: number;
  columnCount: number;
  formulaCellCount: number;
};

export type SafeSpreadsheetWorkbook = {
  sheets: SafeSpreadsheetSheet[];
  metadata: {
    compressedBytes: number;
    declaredUncompressedBytes: number | null;
    zipEntryCount: number | null;
    formulaCellCount: number;
    rowCount: number;
    cellCount: number;
    durationMs: number;
    container: "ZIP" | "OLE";
  };
};

export type ParseSecureSpreadsheetInput = {
  buffer: Buffer;
  fileName: string;
  mimeType?: string | null;
  purpose: SpreadsheetPurpose;
  allowedExtensions?: readonly ("xlsx" | "xlsm" | "xls")[];
  raw?: boolean;
  blankRows?: boolean;
  signal?: AbortSignal;
};

export class SpreadsheetSecurityError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "SpreadsheetSecurityError";
    this.code = code;
    this.status = status;
  }
}

type ContainerInspection = {
  container: "ZIP" | "OLE";
  declaredUncompressedBytes: number | null;
  zipEntryCount: number | null;
};

type WorkerResponse =
  | { ok: true; sheets: SafeSpreadsheetSheet[]; formulaCellCount: number; rowCount: number; cellCount: number }
  | { ok: false; code: string; message: string };

const WORKER_SOURCE = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");
  const limits = workerData.limits;

  function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }

  function safeCell(value) {
    if (value == null) return null;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return value;
    }
    if (typeof value === "string") {
      if (value.length > limits.maxCellTextLength) fail("CELL_TEXT_TOO_LONG", "O celulă depășește lungimea maximă permisă.");
      return value;
    }
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "boolean") return value;
    const text = String(value);
    if (text.length > limits.maxCellTextLength) fail("CELL_TEXT_TOO_LONG", "O celulă depășește lungimea maximă permisă.");
    return text;
  }

  try {
    const XLSX = require(workerData.moduleName);
    const workbook = XLSX.read(Buffer.from(workerData.buffer), {
      type: "buffer",
      cellDates: true,
      cellFormula: true,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      bookFiles: false,
      bookDeps: false,
      WTF: false
    });

    if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) fail("EMPTY_WORKBOOK", "Fișierul nu conține foi de calcul.");
    if (workbook.SheetNames.length > limits.maxSheets) fail("TOO_MANY_SHEETS", "Fișierul conține prea multe foi de calcul.");

    let totalCells = 0;
    let totalRows = 0;
    let totalFormulaCells = 0;
    const sheets = [];

    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      let formulaCellCount = 0;
      const hyperlinks = Object.create(null);
      let minRow = Number.MAX_SAFE_INTEGER;
      let minColumn = Number.MAX_SAFE_INTEGER;
      let maxRow = -1;
      let maxColumn = -1;
      for (const key of Object.keys(sheet)) {
        if (key[0] === "!") continue;
        const cell = sheet[key];
        const coordinate = XLSX.utils.decode_cell(key);
        minRow = Math.min(minRow, coordinate.r);
        minColumn = Math.min(minColumn, coordinate.c);
        maxRow = Math.max(maxRow, coordinate.r);
        maxColumn = Math.max(maxColumn, coordinate.c);
        if (cell && cell.f != null) formulaCellCount += 1;
        if (cell && cell.l && typeof cell.l.Target === "string") {
          try {
            const url = new URL(cell.l.Target);
            if ((url.protocol === "http:" || url.protocol === "https:") && cell.l.Target.length <= 2048) hyperlinks[key] = cell.l.Target;
          } catch {}
        }
        if (cell) {
          delete cell.f;
          delete cell.F;
          delete cell.l;
          delete cell.h;
          delete cell.c;
        }
      }

      const rowCount = maxRow >= 0 ? maxRow - minRow + 1 : 0;
      const columnCount = maxColumn >= 0 ? maxColumn - minColumn + 1 : 0;
      if (rowCount > limits.maxRowsPerSheet) fail("TOO_MANY_ROWS", "O foaie depășește numărul maxim de rânduri.");
      if (columnCount > limits.maxColumnsPerSheet) fail("TOO_MANY_COLUMNS", "O foaie depășește numărul maxim de coloane.");
      totalCells += rowCount * columnCount;
      if (totalCells > limits.maxCells) fail("TOO_MANY_CELLS", "Fișierul depășește numărul maxim de celule.");
      if (rowCount && columnCount) sheet["!ref"] = XLSX.utils.encode_range({ s: { r: minRow, c: minColumn }, e: { r: maxRow, c: maxColumn } });

      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        blankrows: workerData.blankRows,
        raw: workerData.raw
      }).map((row) => Array.isArray(row) ? row.map(safeCell) : []);
      totalRows += rows.length;
      totalFormulaCells += formulaCellCount;
      sheets.push({ name, rows, hyperlinks, rowCount: rows.length, columnCount, formulaCellCount });
    }

    if (totalRows === 0) fail("EMPTY_WORKBOOK", "Fișierul nu conține date în foile de calcul.");

    parentPort.postMessage({ ok: true, sheets, formulaCellCount: totalFormulaCells, rowCount: totalRows, cellCount: totalCells });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      code: error && error.code ? String(error.code) : "PARSER_ERROR",
      message: error && error.message ? String(error.message) : "Fișierul nu poate fi citit."
    });
  }
`;

export async function parseSecureSpreadsheet(input: ParseSecureSpreadsheetInput): Promise<SafeSpreadsheetWorkbook> {
  const startedAt = Date.now();
  let inspection: ContainerInspection | null = null;
  try {
    inspection = validateSpreadsheetEnvelope(input);
    const workerResult = await runParserWorker(input);
    for (const sheet of workerResult.sheets) validateSheetName(sheet.name);
    const result: SafeSpreadsheetWorkbook = {
      sheets: workerResult.sheets,
      metadata: {
        compressedBytes: input.buffer.length,
        declaredUncompressedBytes: inspection.declaredUncompressedBytes,
        zipEntryCount: inspection.zipEntryCount,
        formulaCellCount: workerResult.formulaCellCount,
        rowCount: workerResult.rowCount,
        cellCount: workerResult.cellCount,
        durationMs: Date.now() - startedAt,
        container: inspection.container
      }
    };
    logSpreadsheetResult(input.purpose, "accepted", result.metadata.durationMs, input.buffer.length, result.metadata);
    return result;
  } catch (error) {
    const safeError = normalizeSpreadsheetError(error);
    logSpreadsheetResult(input.purpose, safeError.code, Date.now() - startedAt, input.buffer.length, inspection);
    throw safeError;
  }
}

export function validateSpreadsheetEnvelope(input: ParseSecureSpreadsheetInput): ContainerInspection {
  if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
    throw new SpreadsheetSecurityError("EMPTY_FILE", "Fișierul este gol.");
  }
  if (input.buffer.length > SPREADSHEET_LIMITS.maxCompressedBytes) {
    throw new SpreadsheetSecurityError("FILE_TOO_LARGE", "Fișierul depășește limita de 20 MB.", 413);
  }

  const extension = extensionFromFileName(input.fileName);
  const allowedExtensions = input.allowedExtensions || (["xlsx", "xlsm", "xls"] as const);
  if (!extension || !allowedExtensions.includes(extension as "xlsx" | "xlsm" | "xls")) {
    throw new SpreadsheetSecurityError("UNSUPPORTED_EXTENSION", "Formatul fișierului nu este acceptat.");
  }

  const mimeType = String(input.mimeType || "").trim().toLowerCase();
  if (!SAFE_MIME_TYPES.has(mimeType)) {
    throw new SpreadsheetSecurityError("UNSUPPORTED_MIME", "Tipul fișierului nu corespunde unui document Excel.");
  }

  const isZip = input.buffer.length >= 4 && input.buffer.readUInt32LE(0) === 0x04034b50;
  const isOle = input.buffer.length >= OLE_MAGIC.length && input.buffer.subarray(0, OLE_MAGIC.length).equals(OLE_MAGIC);
  if ((extension === "xlsx" || extension === "xlsm") && !isZip) {
    throw new SpreadsheetSecurityError("MAGIC_MISMATCH", "Conținutul fișierului nu corespunde extensiei Excel.");
  }
  if (extension === "xls" && !isOle) {
    throw new SpreadsheetSecurityError("MAGIC_MISMATCH", "Conținutul fișierului nu corespunde extensiei Excel.");
  }
  if (isZip) return inspectZipContainer(input.buffer);
  if (isOle) return { container: "OLE", declaredUncompressedBytes: null, zipEntryCount: null };
  throw new SpreadsheetSecurityError("UNSUPPORTED_CONTAINER", "Containerul fișierului nu este recunoscut.");
}

export function excelSerialToUtcDate(value: number): Date | null {
  if (!Number.isFinite(value)) return null;
  const wholeDays = Math.floor(value);
  if (wholeDays <= 0 || wholeDays > 2_958_465) return null;
  const excelEpoch = Date.UTC(1899, 11, 30);
  const result = new Date(excelEpoch + wholeDays * 86_400_000);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function isUnsafeObjectKey(value: string) {
  return UNSAFE_KEYS.has(value.trim().toLowerCase());
}

function inspectZipContainer(buffer: Buffer): ContainerInspection {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new SpreadsheetSecurityError("CORRUPT_ZIP", "Arhiva Excel este coruptă sau incompletă.");
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new SpreadsheetSecurityError("UNSUPPORTED_ZIP", "Arhivele ZIP multi-disc sau Zip64 nu sunt acceptate.");
  }
  if (entryCount === 0 || entryCount > SPREADSHEET_LIMITS.maxZipEntries) {
    throw new SpreadsheetSecurityError("TOO_MANY_ZIP_ENTRIES", "Arhiva Excel conține prea multe fișiere interne.");
  }
  if (centralOffset + centralSize > eocdOffset || centralOffset < 0) {
    throw new SpreadsheetSecurityError("CORRUPT_ZIP", "Directorul intern al fișierului Excel este invalid.");
  }

  let cursor = centralOffset;
  let totalUncompressed = 0;
  let hasWorkbook = false;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new SpreadsheetSecurityError("CORRUPT_ZIP", "Structura internă a fișierului Excel este invalidă.");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > buffer.length || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new SpreadsheetSecurityError("UNSUPPORTED_ZIP", "Fișierul Excel folosește o structură ZIP neacceptată.");
    }
    if ((flags & 0x1) !== 0) {
      throw new SpreadsheetSecurityError("ENCRYPTED_WORKBOOK", "Fișierele Excel criptate nu sunt acceptate.");
    }
    const entryName = buffer.toString((flags & 0x800) !== 0 ? "utf8" : "latin1", cursor + 46, cursor + 46 + nameLength).replace(/\\/g, "/");
    if (!entryName || entryName.startsWith("/") || entryName.split("/").includes("..") || entryName.includes("\u0000")) {
      throw new SpreadsheetSecurityError("UNSAFE_ZIP_PATH", "Fișierul Excel conține o cale internă nesigură.");
    }
    if (uncompressedSize > SPREADSHEET_LIMITS.maxSingleEntryBytes) {
      throw new SpreadsheetSecurityError("ZIP_ENTRY_TOO_LARGE", "Un element intern al fișierului este prea mare.", 413);
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > SPREADSHEET_LIMITS.maxUncompressedBytes) {
      throw new SpreadsheetSecurityError("ZIP_BOMB", "Dimensiunea decomprimată a fișierului depășește limita permisă.", 413);
    }
    if (entryName === "xl/workbook.xml" || entryName === "xl/workbook.bin") hasWorkbook = true;
    cursor = entryEnd;
  }
  if (!hasWorkbook) throw new SpreadsheetSecurityError("MISSING_WORKBOOK", "Containerul nu conține un registru Excel valid.");
  return { container: "ZIP", declaredUncompressedBytes: totalUncompressed, zipEntryCount: entryCount };
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function extensionFromFileName(fileName: string) {
  const match = String(fileName || "").trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || null;
}

function validateSheetName(name: string) {
  const normalized = name.trim().toLowerCase();
  if (!SAFE_SHEET_NAME.test(name) || UNSAFE_KEYS.has(normalized)) {
    throw new SpreadsheetSecurityError("UNSAFE_SHEET_NAME", "Fișierul conține un nume de foaie neacceptat.");
  }
}

function runParserWorker(input: ParseSecureSpreadsheetInput): Promise<Extract<WorkerResponse, { ok: true }>> {
  if (input.signal?.aborted) return Promise.reject(new SpreadsheetSecurityError("PARSE_CANCELLED", "Citirea fișierului a fost anulată.", 408));
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        buffer: input.buffer,
        moduleName: "xlsx",
        raw: input.raw !== false,
        blankRows: input.blankRows === true,
        limits: SPREADSHEET_LIMITS
      },
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      void worker.terminate();
      finish(() => reject(new SpreadsheetSecurityError("PARSE_CANCELLED", "Citirea fișierului a fost anulată.", 408)));
    };
    const timeout = setTimeout(() => {
      void worker.terminate();
      finish(() => reject(new SpreadsheetSecurityError("PARSE_TIMEOUT", "Fișierul necesită prea mult timp pentru procesare.", 408)));
    }, SPREADSHEET_LIMITS.parseTimeoutMs);
    input.signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (message: WorkerResponse) => {
      finish(() => {
        void worker.terminate();
        if (message.ok) resolve(message);
        else reject(new SpreadsheetSecurityError(message.code, safeParserMessage(message.code, message.message)));
      });
    });
    worker.once("error", (error) => finish(() => reject(new SpreadsheetSecurityError("PARSER_WORKER_ERROR", safeParserMessage("PARSER_ERROR", error.message)))));
    worker.once("exit", (code) => {
      if (code !== 0) finish(() => reject(new SpreadsheetSecurityError("PARSER_WORKER_EXIT", "Fișierul nu a putut fi procesat în siguranță.")));
    });
  });
}

function safeParserMessage(code: string, message: string) {
  if (["EMPTY_WORKBOOK", "TOO_MANY_SHEETS", "TOO_MANY_ROWS", "TOO_MANY_COLUMNS", "TOO_MANY_CELLS", "CELL_TEXT_TOO_LONG"].includes(code)) return message;
  return "Fișierul Excel este corupt, criptat sau într-un format neacceptat.";
}

function normalizeSpreadsheetError(error: unknown) {
  if (error instanceof SpreadsheetSecurityError) return error;
  return new SpreadsheetSecurityError("PARSER_ERROR", "Fișierul Excel nu a putut fi procesat în siguranță.");
}

function logSpreadsheetResult(purpose: SpreadsheetPurpose, result: string, durationMs: number, compressedBytes: number, details: Partial<SafeSpreadsheetWorkbook["metadata"]> | ContainerInspection | null) {
  console.info("spreadsheet_import", {
    purpose,
    result,
    durationMs,
    compressedBytes,
    rowCount: "rowCount" in (details || {}) ? (details as Partial<SafeSpreadsheetWorkbook["metadata"]>).rowCount : undefined,
    cellCount: "cellCount" in (details || {}) ? (details as Partial<SafeSpreadsheetWorkbook["metadata"]>).cellCount : undefined,
    container: details?.container
  });
}
