import type { UserRole } from "@/lib/rbac";
import type { ReservationStatus } from "@/types/location";

const transitions: Record<ReservationStatus, readonly ReservationStatus[]> = {
  HOLD: ["RESERVED", "BOOKED", "CANCELLED", "EXPIRED"],
  RESERVED: ["BOOKED", "CANCELLED", "EXPIRED"],
  BOOKED: ["CANCELLED"],
  CANCELLED: [],
  EXPIRED: []
};

export function canTransitionReservation(from: ReservationStatus, to: ReservationStatus) {
  return from === to || transitions[from]?.includes(to) === true;
}

export function assertReservationTransition(from: ReservationStatus, to: ReservationStatus, role: UserRole) {
  if (!canTransitionReservation(from, to)) {
    throw new Error(`Tranzitia ${from} -> ${to} nu este permisa.`);
  }
  if (role === "SALES_AGENT" && to === "BOOKED") {
    throw new Error("Inchirierea trebuie confirmata de directorul de vanzari, COO sau administrator.");
  }
}

export function allowedReservationTransitions(status: ReservationStatus, role: UserRole) {
  return transitions[status].filter((next) => role !== "SALES_AGENT" || next !== "BOOKED");
}
