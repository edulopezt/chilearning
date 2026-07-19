import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { esCL } from "@/i18n/es-CL";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

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
    <html lang="es-CL" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
