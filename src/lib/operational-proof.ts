import type { AuthSession } from "@/lib/auth";
import type { OperationKind } from "@/lib/operation-status";
import type { ReservationDTO } from "@/types/location";

export const OPERATIONAL_PROOF_DOCUMENT_TYPE = "operational_proof_photo";
export const OPERATIONAL_PROOF_RETENTION_DAYS = 30;
export const OPERATIONAL_PROOF_MAX_FILES_PER_TASK = 10;
export const OPERATIONAL_PROOF_MAX_FILE_SIZE = 4 * 1024 * 1024;
export const OPERATIONAL_PROOF_MAX_TOTAL_SIZE = 4 * 1024 * 1024;
export const OPERATIONAL_PROOF_MAX_PIXELS = 40_000_000;
export const OPERATIONAL_PROOF_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type OperationalProofPurpose =
  | "INSTALLATION_PROOF"
  | "DECORATION_PROOF"
  | "NEUTRALIZATION_PROOF"
  | "OTHER_OPERATIONAL_PROOF";

export type OperationalProofNotes = {
  purpose: OperationalProofPurpose;
  kind: OperationKind;
  taskId?: string | null;
  completionNote?: string | null;
  uploadedByUserId?: string | null;
  expiresInDays: number;
};

export function operationalProofPurpose(kind: OperationKind): OperationalProofPurpose {
  return kind === "decoration" ? "DECORATION_PROOF" : "NEUTRALIZATION_PROOF";
}

export function operationalProofExpiryDate(uploadedAt = new Date()) {
  const expiresAt = new Date(uploadedAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + OPERATIONAL_PROOF_RETENTION_DAYS);
  return expiresAt;
}

export function isOperationalProofMimeType(value?: string | null) {
  return OPERATIONAL_PROOF_MIME_TYPES.includes(value as (typeof OPERATIONAL_PROOF_MIME_TYPES)[number]);
}

export function validateOperationalProofFile(file: File) {
  if (!isOperationalProofMimeType(file.type)) {
    throw new Error("Incarca doar imagini JPG, PNG sau WebP.");
  }
  if (file.size > OPERATIONAL_PROOF_MAX_FILE_SIZE) {
    throw new Error("O poza dovada poate avea maximum 4 MB.");
  }
}

export function validateOperationalProofUploadTotal(files: File[]) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > OPERATIONAL_PROOF_MAX_TOTAL_SIZE) {
    throw new Error("Pozele dintr-o finalizare pot avea maximum 4 MB in total.");
  }
}

export async function readAndValidateOperationalProofFile(file: File) {
  validateOperationalProofFile(file);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw new Error("Fisierul incarcat este incomplet.");
  const decoded = validateOperationalProofBuffer(bytes, file.type);
  return { bytes, ...decoded };
}

export function validateOperationalProofBuffer(bytes: Buffer, declaredMimeType: string) {
  const decoded = decodeOperationalProofImage(bytes);
  if (!decoded || decoded.mimeType !== declaredMimeType) {
    throw new Error("Continutul pozei nu corespunde tipului de fisier declarat.");
  }
  if (decoded.width < 1 || decoded.height < 1 || decoded.width * decoded.height > OPERATIONAL_PROOF_MAX_PIXELS) {
    throw new Error("Rezolutia pozei este invalida sau prea mare.");
  }
  return decoded;
}

export function safeOperationalProofFileName(value: string) {
  const clean = value.replace(/[^\w.\- ]+/g, "_").trim();
  return clean || "dovada-operationala.jpg";
}

type DecodedOperationalProofImage = {
  mimeType: (typeof OPERATIONAL_PROOF_MIME_TYPES)[number];
  width: number;
  height: number;
};

function decodeOperationalProofImage(bytes: Buffer): DecodedOperationalProofImage | null {
  return decodePng(bytes) || decodeJpeg(bytes) || decodeWebp(bytes);
}

function decodePng(bytes: Buffer): DecodedOperationalProofImage | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature) || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > bytes.length) return null;
    if (bytes.toString("ascii", offset + 4, offset + 8) === "IEND") {
      return chunkLength === 0 && chunkEnd === bytes.length ? { mimeType: "image/png", width, height } : null;
    }
    offset = chunkEnd;
  }
  return null;
}

function decodeJpeg(bytes: Buffer): DecodedOperationalProofImage | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (startOfFrame.has(marker)) {
      if (segmentLength < 7) return null;
      return { mimeType: "image/jpeg", height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += segmentLength;
  }
  return null;
}

function decodeWebp(bytes: Buffer): DecodedOperationalProofImage | null {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      mimeType: "image/webp",
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3)
    };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    return {
      mimeType: "image/webp",
      width: 1 + b0 + ((b1 & 0x3f) << 8),
      height: 1 + ((b1 & 0xc0) >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10)
    };
  }
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      mimeType: "image/webp",
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff
    };
  }
  return null;
}

export function operationalProofNotes(input: {
  kind: OperationKind;
  taskId?: string | null;
  completionNote?: string | null;
  uploadedByUserId?: string | null;
}) {
  const payload: OperationalProofNotes = {
    purpose: operationalProofPurpose(input.kind),
    kind: input.kind,
    taskId: input.taskId || null,
    completionNote: input.completionNote || null,
    uploadedByUserId: input.uploadedByUserId || null,
    expiresInDays: OPERATIONAL_PROOF_RETENTION_DAYS
  };
  return JSON.stringify(payload);
}

export function parseOperationalProofNotes(value?: string | null): OperationalProofNotes | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<OperationalProofNotes>;
    if (parsed.kind !== "decoration" && parsed.kind !== "neutralization") return null;
    return {
      purpose: parsed.purpose || operationalProofPurpose(parsed.kind),
      kind: parsed.kind,
      taskId: parsed.taskId || null,
      completionNote: parsed.completionNote || null,
      uploadedByUserId: parsed.uploadedByUserId || null,
      expiresInDays: OPERATIONAL_PROOF_RETENTION_DAYS
    };
  } catch {
    return null;
  }
}

export function operationalProofDownloadPath(id: string) {
  return `/api/admin/operational/proof-photos/${id}`;
}

export function isOperationalProofActive(document: { status?: string | null; expiryDate?: Date | string | null }) {
  if (document.status && document.status !== "active") return false;
  if (!document.expiryDate) return true;
  const expiry = document.expiryDate instanceof Date ? document.expiryDate : new Date(document.expiryDate);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() >= Date.now();
}

type OperationalReservationAccess = Pick<ReservationDTO, "status" | "ownerId" | "sellerUserId" | "salesperson"> & {
  clientAccountOwnerUserId?: string | null;
  client?: { accountOwnerUserId: string | null } | null;
};

export function canAccessOperationalReservation(session: AuthSession, reservation: OperationalReservationAccess) {
  if (["SUPER_ADMIN", "COO", "SALES_DIRECTOR"].includes(session.role)) return true;
  // Field access requires a relational assignment and is checked asynchronously at the API boundary.
  if (session.role === "FIELD_OPERATOR") return false;
  if (session.role !== "SALES_AGENT") return false;

  const legacyOwner = reservation.salesperson === session.name || reservation.salesperson === session.email;
  const clientOwnerUserId = reservation.clientAccountOwnerUserId ?? reservation.client?.accountOwnerUserId ?? null;
  return (
    reservation.sellerUserId === session.id ||
    reservation.ownerId === session.id ||
    clientOwnerUserId === session.id ||
    Boolean(!reservation.ownerId && legacyOwner)
  );
}

export function canViewOperationalProofPhoto(session: AuthSession, reservation: OperationalReservationAccess) {
  if (["SUPER_ADMIN", "COO", "SALES_DIRECTOR"].includes(session.role)) return true;
  return canAccessOperationalReservation(session, reservation);
}

export function canCompleteOperationalReservation(session: AuthSession, reservation: OperationalReservationAccess) {
  if (reservation.status !== "BOOKED") return false;
  return canAccessOperationalReservation(session, reservation);
}

export function canRescheduleOperationalReservation(session: AuthSession, reservation: OperationalReservationAccess) {
  if (reservation.status !== "BOOKED") return false;
  if (session.role === "FIELD_OPERATOR") return false;
  return canAccessOperationalReservation(session, reservation);
}
