"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "pwa-install-dismissed";

function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

// A custom install prompt: Chrome/Edge/Android only ever offer their own
// mini-infobar if we don't intercept `beforeinstallprompt`, and Safari never
// fires it at all — so this shows a consistent banner everywhere, with
// manual "Add to Home Screen" instructions as the iOS fallback.
export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // Private-mode/blocked storage — fall through and just show the banner.
    }
    setDismissed(false);

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setDeferredPrompt(null);
      setDismissed(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (isIos()) setShowIosHint(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === "accepted") setDismissed(true);
  }

  if (dismissed || (!deferredPrompt && !showIosHint)) return null;

  return (
    <div style={{
      position: "fixed", left: "1rem", right: "1rem", bottom: "1rem", zIndex: 2000,
      maxWidth: 420, margin: "0 auto",
      background: "#111827", color: "#fff", borderRadius: 14,
      padding: "0.9rem 1rem", boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={40} height={40} style={{ borderRadius: 10, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 700, fontSize: "0.85rem", margin: 0 }}>Install ConstructIQ</p>
        <p style={{ fontSize: "0.72rem", color: "#9ca3af", margin: 0, marginTop: 2 }}>
          {deferredPrompt
            ? "Add it to your device for quick, full-screen access."
            : "Tap Share, then \"Add to Home Screen\"."}
        </p>
      </div>
      {deferredPrompt && (
        <button onClick={handleInstall} style={{
          display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 8,
          border: "none", background: "#2563eb", color: "#fff", fontSize: "0.78rem", fontWeight: 700,
          cursor: "pointer", whiteSpace: "nowrap",
        }}>
          <Download style={{ width: 14, height: 14 }} /> Install
        </button>
      )}
      <button onClick={dismiss} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", flexShrink: 0 }}>
        <X style={{ width: 16, height: 16 }} />
      </button>
    </div>
  );
}
