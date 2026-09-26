import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import ThemeApplier from "@/components/layout/ThemeApplier";
import PwaRegister from "@/components/layout/PwaRegister";
import InstallBanner from "@/components/layout/InstallBanner";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ConstructIQ",
  description: "Smart Construction Material Demand Forecasting and Waste Optimization System",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ConstructIQ",
  },
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
        <PwaRegister />
        <div id="app-shell">{children}</div>
        <div id="dark-navy-tint" />
        <InstallBanner />
      </body>
    </html>
  );
}
