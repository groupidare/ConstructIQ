import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import ThemeApplier from "@/components/layout/ThemeApplier";
import PwaRegister from "@/components/layout/PwaRegister";
import InstallBanner from "@/components/layout/InstallBanner";
import "./globals.css";

// Browser extensions that scan forms (password managers, form-fillers) tag
// every button/input on the page with an `fdprocessedid` attribute before
// React hydrates — an attribute our own code never renders, so it trips
// React's hydration-mismatch warning on effectively every interactive
// element. A React-component useEffect is too late to filter it: that
// mismatch is logged synchronously during React's hydration commit, which
// finishes before any effect in the tree runs. This has to run as a plain
// inline script instead, so it executes (and patches console.error) before
// the hydration bundle does. Every other console.error still passes through
// untouched; dev-only, since it's just console noise, not a real bug.
const HYDRATION_NOISE_FILTER_SCRIPT = `
(function () {
  var original = console.error;
  console.error = function (first) {
    if (typeof first === "string" && first.indexOf("hydrated but some attributes of the server rendered HTML didn't match") !== -1) {
      return;
    }
    return original.apply(console, arguments);
  };
})();
`;

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
        {process.env.NODE_ENV === "development" && (
          <script dangerouslySetInnerHTML={{ __html: HYDRATION_NOISE_FILTER_SCRIPT }} />
        )}
        <ThemeApplier />
        <PwaRegister />
        <div id="app-shell">{children}</div>
        <div id="dark-navy-tint" />
        <InstallBanner />
      </body>
    </html>
  );
}
