"use client";

import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Mail, ArrowLeft, Loader2, ExternalLink } from "lucide-react";
import api from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) { toast.error("Enter your email address."); return; }
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
    } catch {
      // Backend always responds the same way regardless of outcome — nothing to react to here.
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    paddingLeft: 40, paddingRight: 16, paddingTop: 10, paddingBottom: 10,
    borderRadius: 8, background: "#060e1e",
    border: "1px solid #1e3a5f", color: "#fff",
    fontSize: "0.875rem", outline: "none",
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "1rem", background: "linear-gradient(135deg, #0b1120 0%, #0f2040 100%)",
    }}>
      <div style={{
        width: "100%", maxWidth: 400, background: "#0d1526", borderRadius: 16,
        padding: "2.5rem 2rem", boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1.5rem" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "#f97316", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: "1.05rem" }}>ConstructIQ</span>
        </div>

        <h2 style={{ color: "#fb923c", fontWeight: 700, fontSize: "1.4rem", marginBottom: "0.4rem" }}>Forgot your password?</h2>

        {sent ? (
          <>
            <p style={{ color: "#9ca3af", fontSize: "0.85rem", lineHeight: 1.6, marginBottom: "1.25rem" }}>
              If <strong style={{ color: "#d1d5db" }}>{email}</strong> is registered, a reset link has been sent — check your inbox (and spam folder). The link expires in 30 minutes.
            </p>
            <a
              href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#inbox`}
              target="_blank" rel="noopener noreferrer"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "11px", borderRadius: 8, border: "none", marginBottom: "1rem",
                background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.9rem", textDecoration: "none",
              }}
            >
              <ExternalLink style={{ width: 15, height: 15 }} /> Open Gmail
            </a>
            <Link href="/login" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: "#9ca3af", fontSize: "0.8rem", textDecoration: "none" }}>
              <ArrowLeft style={{ width: 13, height: 13 }} /> Back to login
            </Link>
          </>
        ) : (
          <>
            <p style={{ color: "#9ca3af", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
              Enter your account's email address and we'll send you a link to reset your password.
            </p>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div>
                <label style={{ display: "block", color: "#d1d5db", fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.375rem" }}>Email address</label>
                <div style={{ position: "relative" }}>
                  <Mail style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "#4b5563", pointerEvents: "none" }} />
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="yourname@constructiq.com" autoComplete="email" suppressHydrationWarning
                    style={inputStyle}
                  />
                </div>
              </div>
              <button
                type="submit" disabled={loading}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  padding: "11px", borderRadius: 8, border: "none",
                  background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.9rem",
                  cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1,
                }}
              >
                {loading && <Loader2 style={{ width: 15, height: 15 }} className="animate-spin" />}
                {loading ? "Sending…" : "Send reset link"}
              </button>
              <Link href="/login" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: "#9ca3af", fontSize: "0.8rem", textDecoration: "none" }}>
                <ArrowLeft style={{ width: 13, height: 13 }} /> Back to login
              </Link>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
