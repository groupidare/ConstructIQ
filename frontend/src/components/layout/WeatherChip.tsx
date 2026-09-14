"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, MapPin, Wind, Droplets } from "lucide-react";
import { useWeatherStore } from "@/store/weatherStore";
import { RISK_VISUALS } from "@/lib/weather";

export default function WeatherChip() {
  const status = useWeatherStore((s) => s.status);
  const snapshot = useWeatherStore((s) => s.snapshot);
  const risk = useWeatherStore((s) => s.risk);
  const usingFallbackLocation = useWeatherStore((s) => s.usingFallbackLocation);
  const fetchWeather = useWeatherStore((s) => s.fetchWeather);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  if ((status === "locating" || status === "loading") && !snapshot) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 8, padding: "5px 12px" }}>
        <span style={{ fontSize: "0.72rem", color: "#9ca3af" }}>Locating weather…</span>
      </div>
    );
  }

  if (status === "error" && !snapshot) {
    return (
      <button
        onClick={() => fetchWeather(true)}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: "0.7rem", color: "#9ca3af" }}
      >
        <RefreshCw style={{ width: 12, height: 12 }} /> Weather unavailable
      </button>
    );
  }

  if (!snapshot || !risk) return null;

  const style = RISK_VISUALS[risk.level];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: style.bg, border: `1px solid ${style.border}`, borderRadius: 8,
          padding: "5px 10px", cursor: "pointer",
        }}
      >
        <span style={{ fontSize: "1rem", lineHeight: 1 }}>{snapshot.emoji}</span>
        <div style={{ lineHeight: 1.2, textAlign: "left" }}>
          <span style={{ fontWeight: 700, fontSize: "0.8rem", color: "#111827" }}>{snapshot.tempC}°C</span>
          <span style={{ color: "#9ca3af", fontSize: "0.68rem", marginLeft: 5 }}>
            {snapshot.conditionLabel} · {snapshot.locationName}
          </span>
        </div>
        {(risk.level === "high" || risk.level === "extreme") && (
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: style.dot, flexShrink: 0 }} />
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 10px)", right: 0, width: 300,
            background: "#fff", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
            border: "1px solid #e5e7eb", zIndex: 999, padding: "14px 16px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div>
              <p style={{ fontWeight: 800, fontSize: "1.4rem", color: "#111827", lineHeight: 1 }}>
                {snapshot.emoji} {snapshot.tempC}°C
              </p>
              <p style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: 2 }}>{snapshot.conditionLabel}</p>
            </div>
            <button onClick={() => fetchWeather(true)} title="Refresh" style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}>
              <RefreshCw style={{ width: 14, height: 14 }} />
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.72rem", color: "#6b7280", marginBottom: 10 }}>
            <MapPin style={{ width: 12, height: 12 }} />
            {snapshot.locationName}
            {usingFallbackLocation && <span style={{ color: "#d97706" }}> (approximate — location permission not granted)</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f9fafb", borderRadius: 8, padding: "6px 8px" }}>
              <Wind style={{ width: 13, height: 13, color: "#6b7280" }} />
              <span style={{ fontSize: "0.74rem", color: "#374151" }}>{snapshot.windKph} km/h</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f9fafb", borderRadius: 8, padding: "6px 8px" }}>
              <Droplets style={{ width: 13, height: 13, color: "#6b7280" }} />
              <span style={{ fontSize: "0.74rem", color: "#374151" }}>{snapshot.humidityPct}% humidity</span>
            </div>
          </div>

          <div style={{ background: style.badgeBg, borderRadius: 8, padding: "8px 10px" }}>
            <p style={{ fontSize: "0.7rem", fontWeight: 700, color: style.badgeColor, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {risk.level} construction risk
            </p>
            <p style={{ fontSize: "0.72rem", color: "#374151", lineHeight: 1.4 }}>{risk.advisory}</p>
          </div>
        </div>
      )}
    </div>
  );
}
