import type { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";

export type ReservationReader = Pick<AuthSession, "id" | "name" | "email" | "role">;
type OwnedReservation = { ownerId: string | null; sellerUserId?: string | null; salesperson: string | null };

/** Availability is shared; customer, contract, group and pricing details are not. */
export function canReadReservationDetails(reader: ReservationReader | null | undefined, row: OwnedReservation): boolean {
  if (!reader) return false;
  if (["COO", "SUPER_ADMIN", "D_CEO", "SALES_DIRECTOR"].includes(reader.role)) return true;
  if (reader.role !== "SALES_AGENT") return false;
  return row.sellerUserId === reader.id || row.ownerId === reader.id ||
    (row.ownerId == null && row.sellerUserId == null && [reader.name, reader.email].includes(row.salesperson || ""));
}

export function reservationDetailsWhere(reader: ReservationReader | null | undefined): Prisma.ReservationWhereInput {
  if (!reader) return { id: { in: [] } };
  if (["COO", "SUPER_ADMIN", "D_CEO", "SALES_DIRECTOR"].includes(reader.role)) return {};
  if (reader.role !== "SALES_AGENT") return { id: { in: [] } };
  return { OR: [
    { sellerUserId: reader.id },
    { ownerId: reader.id },
    { ownerId: null, sellerUserId: null, salesperson: { in: [reader.name, reader.email] } }
  ] };
}
