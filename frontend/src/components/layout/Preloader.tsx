"use client";

import { useEffect, useRef, useState } from "react";

// The branded loading animation, made from public/constructiq-preloader.mp4
// as a transparent animated WebP (logo + "LOADING.." only, no background),
// so it sits cleanly on the blurred page. A small still of the full logo
// shows instantly until the animation has downloaded.
export function PreloaderLogo({ height = "min(220px, 40vh)" }: { height?: string }) {
  const anim = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { if (anim.current?.complete) setReady(true); }, []);
  const layer: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", transition: "opacity 0.2s" };
  return (
    <div aria-hidden="true" style={{ position: "relative", height, aspectRatio: "218 / 280", pointerEvents: "none" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/constructiq-preloader-still.png" alt="" className="preloader-logo" style={{ ...layer, opacity: ready ? 0 : 1 }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={anim} src="/constructiq-preloader.webp" alt="" className="preloader-logo" onLoad={() => setReady(true)}
        style={{ ...layer, opacity: ready ? 1 : 0 }} />
    </div>
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
      <PreloaderLogo />
      <p id="app-preloader-slow" suppressHydrationWarning
        style={{ minHeight: "1.5rem", marginTop: "1rem", fontSize: "0.8rem", color: "#6b7280", textAlign: "center", padding: "0 1rem" }} />
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
