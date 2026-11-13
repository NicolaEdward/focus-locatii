/** Allocate integer cents deterministically, preserving the contract total. */
export function allocateMoneyAcrossRows(total: number, count: number): number[] {
  if (!Number.isFinite(total) || total < 0 || !Number.isSafeInteger(count) || count < 1) {
    throw new Error("Totalul sau numarul de amplasamente nu este valid.");
  }
  const cents = Math.round((total + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("Totalul comercial este prea mare.");
  const base = Math.floor(cents / count);
  const remainder = cents % count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}
