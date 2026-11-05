"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getPendingGets, onPendingGetsChange } from "@/lib/api";
import { PreloaderVideo } from "./Preloader";

// Opening a page — from the sidebar, a link or a reload — covers the content
// area with the preloader until that page's data has arrived: every GET the
// page starts has come back and nothing new has started for a moment. Only
// the opening of a page counts; saving or clicking around afterwards never
// brings it back. It fades in after a short delay, so a page whose data is
// already there doesn't flash it.
const START_GRACE_MS = 350;  // time a page gets to start its first requests
const QUIET_MS = 250;        // no requests pending for this long = loaded
const GIVE_UP_MS = 30000;    // never block the page longer than this
const SLOW_HINT_MS = 10000;

export default function PageDataLoader() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoading(true);
    setSlow(false);
    let finished = false;
    const startedAt = Date.now();

    const finish = () => {
      if (finished) return;
      finished = true;
      setLoading(false);
    };
    const check = () => {
      if (finished) return;
      if (quietTimer.current) clearTimeout(quietTimer.current);
      if (getPendingGets() > 0) return;
      const wait = Math.max(QUIET_MS, START_GRACE_MS - (Date.now() - startedAt));
      quietTimer.current = setTimeout(() => { if (getPendingGets() === 0) finish(); }, wait);
    };

    const unsubscribe = onPendingGetsChange(check);
    check();
    const slowTimer = setTimeout(() => setSlow(true), SLOW_HINT_MS);
    const giveUp = setTimeout(finish, GIVE_UP_MS);
    return () => {
      finished = true;
      unsubscribe();
      clearTimeout(slowTimer);
      clearTimeout(giveUp);
      if (quietTimer.current) clearTimeout(quietTimer.current);
    };
  }, [pathname]);

  if (!loading) return null;
  return (
    <div role="status" aria-label="Loading"
      style={{
        position: "absolute", inset: 0, zIndex: 800, background: "#ffffff",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        animation: "preloader-fade-in 0.25s ease 0.2s both",
      }}>
      <PreloaderVideo width="min(560px, 100%)" />
      {slow && (
        <p style={{ marginTop: "-1.5rem", fontSize: "0.8rem", color: "#6b7280", textAlign: "center", padding: "0 1rem" }}>
          Still loading — the connection seems slow.
        </p>
      )}
    </div>
  );
}
