import clsx from "clsx";
import { isPublicRentedStatus, publicStatusLabel } from "@/lib/format";
import type { LocationStatus, PublicAvailabilityStatus } from "@/types/location";

export function StatusBadge({
  status,
  availability,
  publicStatus,
  label
}: {
  status: LocationStatus;
  availability?: string | null;
  publicStatus?: PublicAvailabilityStatus;
  label?: string | null;
}) {
  const displayStatus = publicStatus || (isPublicRentedStatus(status) ? "BOOKED" : status);

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-black uppercase",
        displayStatus === "AVAILABLE" && "border-emerald-300/70 bg-emerald-400/15 text-emerald-200",
        (displayStatus === "BOOKED" || displayStatus === "RESERVED") && "border-red-300/70 bg-red-500/15 text-red-100",
        displayStatus === "UNKNOWN" && "border-slate-300/50 bg-slate-400/10 text-slate-200"
      )}
    >
      {label || publicStatusLabel(status, availability)}
    </span>
  );
}
