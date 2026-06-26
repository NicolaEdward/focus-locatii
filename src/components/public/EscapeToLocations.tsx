"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function EscapeToLocations() {
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isEscapeKey(event)) return;
      event.preventDefault();
      router.push("/locatii");
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return null;
}

function isEscapeKey(event: KeyboardEvent) {
  return event.key === "Escape" || event.key === "Esc" || event.code === "Escape";
}
