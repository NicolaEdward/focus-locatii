import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Focus Media Locatii",
  description: "Portofoliu interactiv de locatii outdoor Focus Media",
  icons: {
    icon: "/icon.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro">
      <body>{children}</body>
    </html>
  );
}
