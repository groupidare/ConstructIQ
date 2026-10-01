import type { CSSProperties } from "react";

export const inp: CSSProperties = {
  width: "100%", boxSizing: "border-box" as const, padding: "9px 12px",
  border: "1px solid #e5e7eb", borderRadius: 8, fontSize: "0.85rem",
  outline: "none", background: "#fff", color: "#111827",
};

export const sel: CSSProperties = { ...inp, cursor: "pointer", appearance: "none" as CSSProperties["appearance"] };

export const lbl: CSSProperties = { display: "block", fontSize: "0.72rem", color: "#6b7280", fontWeight: 500, marginBottom: 4 };

export const disabledOverlay = (editable: boolean): CSSProperties =>
  editable ? {} : { pointerEvents: "none" as const, opacity: 0.65 };
