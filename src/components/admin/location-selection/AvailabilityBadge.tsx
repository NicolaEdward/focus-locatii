"use client";

import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import type { LocationSelectionAvailability } from "@/lib/location-selection-dto";

export function AvailabilityBadge({ availability }: { availability?: LocationSelectionAvailability }) {
  const state = availability?.state || "UNKNOWN";
  const label = availability?.label || "Alege perioada";
  const toneName = availability?.tone || (state === "AVAILABLE" ? "green" : state === "CONFLICT" ? "red" : state === "PARTIAL" ? "yellow" : "gray");
  const tone = {
    green: "border-emerald-300/45 bg-emerald-400/10 text-emerald-100",
    yellow: "border-amber-300/45 bg-amber-400/10 text-amber-100",
    red: "border-red-300/45 bg-red-400/10 text-red-100",
    gray: "border-slate-500/50 bg-white/5 text-slate-200"
  }[toneName];
  const Icon = state === "AVAILABLE" ? CheckCircle2 : state === "CONFLICT" ? AlertTriangle : HelpCircle;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-black uppercase ${tone}`}>
      <Icon size={13} />
      {label}
    </span>
  );
}
