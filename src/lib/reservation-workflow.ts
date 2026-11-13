import type { UserRole } from "@/lib/rbac";
import type { ReservationStatus } from "@/types/location";

const transitions: Record<ReservationStatus, readonly ReservationStatus[]> = {
  HOLD: ["RESERVED", "BOOKED", "CANCELLED", "EXPIRED"],
  RESERVED: ["BOOKED", "CANCELLED", "EXPIRED"],
  BOOKED: ["CANCELLED"],
  CANCELLED: [],
  EXPIRED: []
};

export class ReservationPermissionError extends Error {
  readonly status = 403;
}

export function canConfirmReservation(role: UserRole) {
  return ["SALES_DIRECTOR", "COO", "SUPER_ADMIN"].includes(role);
}

export function assertReservationInitialStatus(status: ReservationStatus, role?: UserRole) {
  if (["CANCELLED", "EXPIRED"].includes(status)) {
    throw new Error("O rezervare noua trebuie sa porneasca drept hold sau inchiriere activa.");
  }
  if (status === "BOOKED" && (!role || !canConfirmReservation(role))) {
    throw new ReservationPermissionError("Inchirierea trebuie confirmata de directorul de vanzari, COO sau administrator.");
  }
}

export function canTransitionReservation(from: ReservationStatus, to: ReservationStatus) {
  return from === to || transitions[from]?.includes(to) === true;
}

export function assertReservationTransition(from: ReservationStatus, to: ReservationStatus, role: UserRole) {
  if (!canTransitionReservation(from, to)) {
    throw new Error(`Tranzitia ${from} -> ${to} nu este permisa.`);
  }
  if (from !== to && to === "BOOKED" && !canConfirmReservation(role)) {
    throw new ReservationPermissionError("Inchirierea trebuie confirmata de directorul de vanzari, COO sau administrator.");
  }
}

export function allowedReservationTransitions(status: ReservationStatus, role: UserRole) {
  return transitions[status].filter((next) => canConfirmReservation(role) || next !== "BOOKED");
}
