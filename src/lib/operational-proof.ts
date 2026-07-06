import type { AuthSession } from "@/lib/auth";
import type { OperationKind } from "@/lib/operation-status";
import type { ReservationDTO } from "@/types/location";

export const OPERATIONAL_PROOF_DOCUMENT_TYPE = "operational_proof_photo";
export const OPERATIONAL_PROOF_RETENTION_DAYS = 30;
export const OPERATIONAL_PROOF_MAX_FILES_PER_TASK = 10;
export const OPERATIONAL_PROOF_MAX_FILE_SIZE = 10 * 1024 * 1024;
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
    throw new Error("O poza dovada poate avea maximum 10 MB.");
  }
}

export function safeOperationalProofFileName(value: string) {
  const clean = value.replace(/[^\w.\- ]+/g, "_").trim();
  return clean || "dovada-operationala.jpg";
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

export function canAccessOperationalReservation(
  session: AuthSession,
  reservation: Pick<ReservationDTO, "status" | "ownerId" | "sellerUserId" | "salesperson">
) {
  if (["SUPER_ADMIN", "COO", "SALES_DIRECTOR"].includes(session.role)) return true;
  if (session.role === "FIELD_OPERATOR") return reservation.status === "BOOKED";
  if (session.role !== "SALES_AGENT") return false;

  const legacyOwner = reservation.salesperson === session.name || reservation.salesperson === session.email;
  return reservation.sellerUserId === session.id || reservation.ownerId === session.id || Boolean(!reservation.ownerId && legacyOwner);
}

export function canViewOperationalProofPhoto(
  session: AuthSession,
  reservation: Pick<ReservationDTO, "status" | "ownerId" | "sellerUserId" | "salesperson">
) {
  if (["SUPER_ADMIN", "COO", "SALES_DIRECTOR", "SALES_AGENT"].includes(session.role)) return true;
  return canAccessOperationalReservation(session, reservation);
}

export function canCompleteOperationalReservation(
  session: AuthSession,
  reservation: Pick<ReservationDTO, "status" | "ownerId" | "sellerUserId" | "salesperson">
) {
  if (reservation.status !== "BOOKED") return false;
  return canAccessOperationalReservation(session, reservation);
}

export function canRescheduleOperationalReservation(
  session: AuthSession,
  reservation: Pick<ReservationDTO, "status" | "ownerId" | "sellerUserId" | "salesperson">
) {
  if (reservation.status !== "BOOKED") return false;
  if (session.role === "FIELD_OPERATOR") return false;
  return canAccessOperationalReservation(session, reservation);
}
