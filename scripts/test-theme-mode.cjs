const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const layout = read("src/app/layout.tsx");
const header = read("src/components/admin/AdminHeader.tsx");
const toggle = read("src/components/admin/ThemeToggle.tsx");
const css = read("src/app/globals.css");

assert(layout.includes("focus-admin-theme"), "theme must be restored before hydration");
assert(layout.includes('adminPath ? "light" : "dark"'), "admin must default to light and public to dark");
assert(layout.includes("suppressHydrationWarning"), "root theme attribute must be hydration-safe");
assert(header.includes("<ThemeToggle />"), "admin header must expose the theme switch");
assert(toggle.includes('localStorage.setItem(ADMIN_THEME_STORAGE_KEY, nextTheme)'), "theme preference must persist");
assert(toggle.includes("aria-label={label}") && toggle.includes("aria-pressed"), "theme control must be accessible");
assert(css.includes('html[data-theme="light"]'), "light theme CSS must exist");
assert(css.includes("color-scheme: light"), "native controls must use the light color scheme");
assert(css.includes('html[data-theme="light"] .focus-shell'), "admin surfaces must be themed");

console.log(
  JSON.stringify(
    {
      passed: 9,
      defaultAdminTheme: "light",
      defaultPublicTheme: "dark",
      persistedPreference: "focus-admin-theme"
    },
    null,
    2
  )
);
