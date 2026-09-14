import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import ThemeApplier from "@/components/layout/ThemeApplier";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ConstructIQ",
  description: "Smart Construction Material Demand Forecasting and Waste Optimization System",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <ThemeApplier />
        <div id="app-shell">{children}</div>
        <div id="dark-navy-tint" />
      </body>
    </html>
  );
}
