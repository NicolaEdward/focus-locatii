"use client";

import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <button
      className="focus-button secondary"
      type="button"
      title="Deconectare"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/admin/login";
      }}
    >
      <LogOut size={18} />
      <span className="sr-only">Deconectare</span>
    </button>
  );
}
