"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const ADMIN_THEME_STORAGE_KEY = "focus-admin-theme";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const syncTheme = () => {
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === ADMIN_THEME_STORAGE_KEY) syncTheme();
    };

    syncTheme();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const nextTheme = theme === "light" ? "dark" : "light";
  const label =
    nextTheme === "light" ? "Activeaza tema luminoasa" : "Activeaza tema intunecata";

  return (
    <button
      aria-label={label}
      aria-pressed={theme === "dark"}
      className="focus-button secondary px-3"
      onClick={() => {
        document.documentElement.dataset.theme = nextTheme;
        localStorage.setItem(ADMIN_THEME_STORAGE_KEY, nextTheme);
        setTheme(nextTheme);
      }}
      title={label}
      type="button"
    >
      {theme === "light" ? <Moon aria-hidden="true" size={18} /> : <Sun aria-hidden="true" size={18} />}
    </button>
  );
}
