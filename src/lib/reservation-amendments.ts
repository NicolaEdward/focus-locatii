/** Calendar dates in storage are inclusive. Never infer an amendment's effective date. */
export type PriceInterval = {
  effectiveFrom: Date;
  effectiveTo: Date | null;
  monthlyRent: number | string | { toString(): string };
  currency: string;
  reason?: string | null;
};

export class ReservationConflictError extends Error {
  readonly status = 409;
  readonly code = "RESERVATION_VERSION_CONFLICT";
  constructor(message = "Înregistrarea a fost modificată de alt coleg. Reîncarcă datele și verifică modificările înainte de salvare.") { super(message); }
}

export class ReservationPreconditionError extends Error {
  readonly status = 428;
  readonly code = "RESERVATION_VERSION_REQUIRED";
  constructor() { super("Lipsește versiunea înregistrării. Reîncarcă formularul înainte de salvare."); }
}

export function reservationMutationFailure(error: unknown, fallback: string) {
  const value = error as { status?: unknown; code?: unknown; name?: unknown; message?: unknown } | null;
  const status = typeof value?.status === "number" && [401, 403, 404, 409, 428].includes(value.status) ? value.status : 400;
  const raw = typeof value?.message === "string" ? value.message : fallback;
  const internal = /prisma\.|PrismaClient|invocation:|database|ECONN|connection|SQLSTATE|Unknown argument|Server has closed/i.test(raw);
  return {
    status,
    body: {
      error: internal ? "Salvarea nu a putut fi confirmată. Reîncarcă înregistrarea și verifică rezultatul înainte de a repeta operația." : value?.name === "ZodError" ? "Datele nu sunt complete sau valide. Verifică datele, sumele și referința documentului." : raw,
      ...(typeof value?.code === "string" && !internal ? { code: value.code } : {})
    }
  };
}

export function assertReservationVersion(row: { updatedAt: Date }, expected?: string | null, required = true) {
  if (!expected) { if (required) throw new ReservationPreconditionError(); return; }
  if (new Date(expected).getTime() !== row.updatedAt.getTime()) throw new ReservationConflictError();
}

export function assertReservationGroupVersions(rows: Array<{ id: string; updatedAt: Date }>, versions?: Record<string, string>, required = true) {
  if (!versions) { if (required) throw new ReservationPreconditionError(); return; }
  const ids = new Set(rows.map((row) => row.id));
  if (Object.keys(versions).length !== rows.length || Object.keys(versions).some((id) => !ids.has(id))) throw new ReservationConflictError("Componența contractului s-a schimbat. Reîncarcă întregul contract înainte de salvare.");
  for (const row of rows) assertReservationVersion(row, versions[row.id]);
}

const dayMs = 86_400_000;
const day = (d: Date) => new Date(d.toISOString().slice(0, 10) + "T00:00:00.000Z");

/** Builds a complete replacement projection; the caller records the old rows in its durable audit. */
export function amendedPriceIntervals(input: {
  previousStart: Date; previousEnd: Date; nextStart: Date; nextEnd: Date;
  previousRent: number; previousCurrency: string;
  nextRent: number; nextCurrency: string;
  segments: PriceInterval[];
  effectiveFrom: Date;
  reference: string;
  mode: "amendment" | "correction";
  changePrice?: boolean;
}) {
  const start = day(input.previousStart), end = day(input.previousEnd);
  const nextStart = day(input.nextStart), nextEnd = day(input.nextEnd), effective = day(input.effectiveFrom);
  if (nextStart > nextEnd || effective < nextStart || effective > nextEnd) throw new Error("Data efectivă trebuie să fie în perioada contractuală propusă.");
  if (!Number.isFinite(input.nextRent) || input.nextRent <= 0 || !["RON", "EUR"].includes(input.nextCurrency)) throw new Error("Actul adițional cere o chirie pozitivă și o monedă validă.");
  const reference = input.reference.trim();
  if (reference.length < 3) throw new Error("Introdu numărul actului adițional sau referința documentului justificativ.");
  const source = (input.segments.length ? input.segments : [{ effectiveFrom: start, effectiveTo: end, monthlyRent: input.previousRent, currency: input.previousCurrency }])
    .map((s) => ({ effectiveFrom: day(s.effectiveFrom), effectiveTo: day(s.effectiveTo || end), monthlyRent: Number(s.monthlyRent), currency: s.currency, reason: s.reason || "Tarif contractual inițial" }))
    .filter((s) => s.effectiveFrom <= end && s.effectiveTo >= start)
    .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  if (input.mode === "correction" && !input.segments.length) {
    if (effective.getTime() !== nextStart.getTime()) throw new Error("O corecție a întregii perioade trebuie să înceapă în prima zi a perioadei propuse.");
    return [{ effectiveFrom: nextStart, effectiveTo: nextEnd, monthlyRent: input.nextRent, currency: input.nextCurrency, reason: `Corecție documentată: ${reference}` }];
  }
  let cursor = start.getTime();
  for (const s of source) {
    const from = Math.max(s.effectiveFrom.getTime(), start.getTime());
    const to = Math.min(s.effectiveTo.getTime(), end.getTime());
    if (from !== cursor || from > to || s.monthlyRent <= 0 || !Number.isFinite(s.monthlyRent) || !["RON", "EUR"].includes(s.currency)) throw new ReservationConflictError("Istoricul tarifelor are goluri, suprapuneri sau valori neverificate. Este necesară verificarea contractului înainte de un act adițional.");
    cursor = to + dayMs;
  }
  if (cursor !== end.getTime() + dayMs) throw new ReservationConflictError("Istoricul tarifelor nu acoperă perioada contractuală. Verifică documentele înainte de modificare.");
  if (input.changePrice === false && nextStart >= start) {
    const clipped = source.flatMap((s) => {
      const from = new Date(Math.max(s.effectiveFrom.getTime(), nextStart.getTime()));
      const to = new Date(Math.min(s.effectiveTo.getTime(), nextEnd.getTime()));
      return from <= to ? [{ ...s, effectiveFrom: from, effectiveTo: to }] : [];
    });
    if (nextEnd > end) {
      const previous = source.at(-1)!;
      const from = new Date(Math.max(end.getTime() + dayMs, nextStart.getTime()));
      clipped.push({ ...previous, effectiveFrom: from, effectiveTo: nextEnd, reason: `Prelungire documentată: ${reference}` });
    }
    if (!clipped.length || clipped[0].effectiveFrom.getTime() !== nextStart.getTime()) throw new Error("Noua perioadă nu are tarif contractual complet.");
    return clipped;
  }
  if (input.mode === "correction") {
    if (effective.getTime() !== nextStart.getTime()) throw new Error("O corecție a întregii perioade trebuie să înceapă în prima zi a perioadei propuse.");
    return [{ effectiveFrom: nextStart, effectiveTo: nextEnd, monthlyRent: input.nextRent, currency: input.nextCurrency, reason: `Corecție documentată: ${reference}` }];
  }
  if (nextStart < start) throw new Error("Extinderea înaintea startului existent cere o corecție documentată distinctă.");
  if (effective.getTime() > end.getTime() + dayMs) throw new Error("Actul adițional ar lăsa o perioadă fără tarif contractual.");
  if (source.some((s) => s.effectiveFrom > effective)) throw new ReservationConflictError("Există deja o schimbare de tarif ulterioară datei propuse. Verifică succesiunea actelor adiționale înainte de înlocuire.");
  const result = source.flatMap((s) => {
    const from = new Date(Math.max(s.effectiveFrom.getTime(), nextStart.getTime()));
    const to = new Date(Math.min(s.effectiveTo.getTime(), nextEnd.getTime(), effective.getTime() - dayMs));
    return from <= to ? [{ ...s, effectiveFrom: from, effectiveTo: to }] : [];
  });
  result.push({ effectiveFrom: effective, effectiveTo: nextEnd, monthlyRent: input.nextRent, currency: input.nextCurrency, reason: `Act adițional: ${reference}` });
  if (!result.length || result[0].effectiveFrom.getTime() !== nextStart.getTime()) throw new Error("Modificarea propusă nu acoperă integral noua perioadă.");
  return result;
}
