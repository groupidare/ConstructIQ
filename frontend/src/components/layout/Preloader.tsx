"use client";

import { useEffect, useState } from "react";

// The branded loading animation (public/constructiq-preloader.mp4 — white
// background, logo + "LOADING.." in the middle). The poster is its last
// frame, shown instantly while the video itself downloads. Multiply blending
// drops its white background, so only the logo shows over the blurred page.
export function PreloaderVideo({ width }: { width: string }) {
  return (
    <video
      src="/constructiq-preloader.mp4"
      poster="/constructiq-preloader-poster.jpg"
      autoPlay muted loop playsInline preload="auto"
      aria-hidden="true"
      className="preloader-video"
      style={{ width, aspectRatio: "16 / 9", objectFit: "cover", display: "block", pointerEvents: "none", mixBlendMode: "multiply" }}
    />
  );
}

// The see-through, blurred cover every preloader uses — the page stays
// faintly visible behind it.
export const PRELOADER_OVERLAY: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(255,255,255,0.5)",
  backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
};

// Opening the site: covers the page from the very first HTML (before the
// app's scripts arrive) until React has started — the gap where a slow
// connection used to look like a broken page. Server-rendered, so it shows
// immediately; it fades out once this component mounts. If the scripts take
// long, the inline script in the root layout adds a "slow connection" hint
// and then a Reload button, since React isn't running yet to do it.
export default function Preloader() {
  const [phase, setPhase] = useState<"shown" | "leaving" | "gone">("shown");

  useEffect(() => {
    setPhase("leaving");
    const t = setTimeout(() => setPhase("gone"), 350);
    return () => clearTimeout(t);
  }, []);

  if (phase === "gone") return null;
  return (
    <div id="app-preloader" role="status" aria-label="Loading ConstructIQ"
      style={{
        ...PRELOADER_OVERLAY, zIndex: 5000,
        opacity: phase === "leaving" ? 0 : 1, transition: "opacity 0.35s ease",
        pointerEvents: phase === "leaving" ? "none" : "auto",
      }}>
      <PreloaderVideo width="min(720px, 100vw)" />
      <p id="app-preloader-slow" suppressHydrationWarning
        style={{ minHeight: "1.5rem", marginTop: "-2rem", fontSize: "0.8rem", color: "#6b7280", textAlign: "center", padding: "0 1rem" }} />
    </div>
  );
}

// Runs as plain inline script, before the app's own scripts: React can't
// show a hint if its code is what's slow to arrive.
export const PRELOADER_SLOW_SCRIPT = `
(function () {
  function slot() { return document.getElementById("app-preloader-slow"); }
  setTimeout(function () {
    var el = slot();
    if (el) el.textContent = "Still loading — the connection seems slow.";
  }, 10000);
  setTimeout(function () {
    var el = slot();
    if (!el) return;
    el.textContent = "This is taking longer than usual. ";
    var b = document.createElement("button");
    b.textContent = "Reload";
    b.style.cssText = "margin-left:6px;padding:4px 12px;border-radius:6px;border:1px solid #d1d5db;background:#fff;color:#111827;font-weight:600;cursor:pointer";
    b.onclick = function () { location.reload(); };
    el.appendChild(b);
  }, 30000);
})();
`;
