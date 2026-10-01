"use client";

import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Calendar } from "lucide-react";

const POPOVER_WIDTH  = 260;
const POPOVER_HEIGHT = 320;

export function DatePickerField({ value, onChange, inputStyle }: { value: Date; onChange: (d: Date) => void; inputStyle: React.CSSProperties }) {
  const [open, setOpen]           = useState(false);
  const [viewYear, setViewYear]   = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());
  const [coords, setCoords]       = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Position the popover relative to the viewport (via a portal) rather than
  // the trigger's own DOM parent, so it can never be clipped or pushed into
  // an awkward scroll position by a modal's overflow. Also flips up/left
  // when there isn't room below/right, so it always stays on screen.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;

    function updatePosition() {
      const rect = wrapRef.current!.getBoundingClientRect();
      let top  = rect.bottom + 6;
      let left = rect.left;
      if (left + POPOVER_WIDTH > window.innerWidth - 8) {
        left = Math.max(8, rect.right - POPOVER_WIDTH);
      }
      if (top + POPOVER_HEIGHT > window.innerHeight - 8) {
        top = Math.max(8, rect.top - POPOVER_HEIGHT - 6);
      }
      setCoords({ top, left });
    }

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  function toggleOpen() {
    setOpen(o => {
      if (!o) { setViewYear(value.getFullYear()); setViewMonth(value.getMonth()); }
      return !o;
    });
  }

  function prevMonth() { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); }
  function nextMonth() { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); }

  const label = value.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays    = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input readOnly value={label} onClick={toggleOpen} style={{ ...inputStyle, paddingRight: 36, cursor: "pointer" }} suppressHydrationWarning />
      <button
        type="button"
        onClick={toggleOpen}
        style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", borderRadius: 6 }}
      >
        <Calendar style={{ width: 16, height: 16, color: "#6b7280" }} />
      </button>

      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 10000, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.18)", padding: "0.75rem", width: POPOVER_WIDTH }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button type="button" onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: "1rem", padding: "2px 8px" }}>‹</button>
            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#111827" }}>
              {new Date(viewYear, viewMonth).toLocaleDateString("en-PH", { month: "long", year: "numeric" })}
            </span>
            <button type="button" onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: "1rem", padding: "2px 8px" }}>›</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <span key={i} style={{ fontSize: "0.62rem", color: "#9ca3af", textAlign: "center", fontWeight: 600 }}>{d}</span>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
            {cells.map((day, i) => {
              if (day === null) return <span key={i} />;
              const isSelected = value.getFullYear() === viewYear && value.getMonth() === viewMonth && value.getDate() === day;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => { onChange(new Date(viewYear, viewMonth, day)); setOpen(false); }}
                  style={{
                    width: 30, height: 30, borderRadius: 8, border: "none", cursor: "pointer",
                    fontSize: "0.75rem", fontWeight: isSelected ? 700 : 500,
                    background: isSelected ? "#f97316" : "transparent",
                    color: isSelected ? "#fff" : "#374151",
                  }}
                >{day}</button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
