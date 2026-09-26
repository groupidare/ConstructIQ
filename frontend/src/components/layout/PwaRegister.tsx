"use client";

import { useEffect } from "react";

// Registered only in production — a dev-mode service worker would keep
// serving cached chunks over Next's own hot-reloading dev server.
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
