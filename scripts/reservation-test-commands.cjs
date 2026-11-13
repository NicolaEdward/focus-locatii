// Synthetic fixture callers explicitly capture the version they are about to edit.
// Tests of stale/missing versions must call the domain service directly.
function versionedReservationCommands(service, prisma) {
  async function rows(id) {
    const anchor = await prisma.reservation.findUniqueOrThrow({ where: { id } });
    return anchor.contractGroupId ? prisma.reservation.findMany({ where: { contractGroupId: anchor.contractGroupId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : [anchor];
  }
  function amendment(input, current) {
    if (current.status !== "BOOKED" || !["amount", "monthlyRentShare", "monthlyRentTotal", "currency", "periodStart", "periodEnd"].some((key) => input[key] !== undefined)) return input;
    return { amendmentMode: "correction", amendmentEffectiveDate: input.periodStart || current.periodStart.toISOString().slice(0, 10), amendmentReference: "Synthetic documented regression correction", ...input };
  }
  return {
    async updateReservation(id, input, actor) {
      const current = await prisma.reservation.findUniqueOrThrow({ where: { id } });
      return service.updateReservation(id, { expectedUpdatedAt: current.updatedAt.toISOString(), ...amendment(input, current) }, actor);
    },
    async updateReservationGroup(id, input, actor) {
      const current = await rows(id);
      const body = { expectedVersions: Object.fromEntries(current.map((row) => [row.id, row.updatedAt.toISOString()])), ...amendment(input, current[0]) };
      if (input.monthlyRentTotal != null && !input.groupRentShares) {
        const cents = Math.round(Number(input.monthlyRentTotal) * 100), base = Math.floor(cents / current.length), rest = cents % current.length;
        body.groupRentShares = current.map((row, index) => ({ reservationId: row.id, monthlyRent: (base + (index < rest ? 1 : 0)) / 100 }));
      }
      return service.updateReservationGroup(id, body, actor);
    },
    async updateReservationGroupStatus(id, status, actor, options = {}) {
      const current = await rows(id);
      return service.updateReservationGroupStatus(id, status, actor, { expectedVersions: Object.fromEntries(current.map((row) => [row.id, row.updatedAt.toISOString()])), ...options });
    }
  };
}
module.exports = { versionedReservationCommands };
