import type { Metadata } from "next";

import { esCL } from "@/i18n/es-CL";

import "./globals.css";

export const metadata: Metadata = {
  title: esCL.common.appName,
  description: esCL.landing.tagline,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-CL">
      <body>{children}</body>
    </html>
  );
}
