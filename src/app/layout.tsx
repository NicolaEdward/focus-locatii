import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Focus Media Locatii",
  description: "Portofoliu interactiv de locatii outdoor Focus Media",
  icons: {
    icon: "/icon.svg"
  }
};

const initialThemeScript = `
(() => {
  try {
    const adminPath = window.location.pathname.startsWith("/admin");
    const saved = adminPath ? window.localStorage.getItem("focus-admin-theme") : null;
    const theme = adminPath && (saved === "light" || saved === "dark")
      ? saved
      : adminPath ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
  } catch {
    const adminPath = window.location.pathname.startsWith("/admin");
    document.documentElement.dataset.theme = adminPath ? "light" : "dark";
  }
})();
`;

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initialThemeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
