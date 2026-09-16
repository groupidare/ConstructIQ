"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { Lock, Loader2, ArrowLeft } from "lucide-react";
import api from "@/lib/api";

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) { toast.error("This reset link is missing its token."); return; }
    if (password.length < 8) { toast.error("Password must be at least 8 characters."); return; }
    if (password !== confirm) { toast.error("Passwords don't match."); return; }

    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, newPassword: password });
      toast.success("Password reset — sign in with your new password.");
      router.push("/login");
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "This reset link is invalid or has expired.");
    } finally {
      setLoading(false);
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

        <h2 style={{ color: "#fb923c", fontWeight: 700, fontSize: "1.4rem", marginBottom: "0.4rem" }}>Set a new password</h2>

        {!token ? (
          <p style={{ color: "#f87171", fontSize: "0.85rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>
            This link is missing its reset token. Request a new one from the login page.
          </p>
        ) : (
          <p style={{ color: "#9ca3af", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
            Choose a new password for your account.
          </p>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <label style={{ display: "block", color: "#d1d5db", fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.375rem" }}>New password</label>
            <div style={{ position: "relative" }}>
              <Lock style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "#4b5563", pointerEvents: "none" }} />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" suppressHydrationWarning style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={{ display: "block", color: "#d1d5db", fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.375rem" }}>Confirm password</label>
            <div style={{ position: "relative" }}>
              <Lock style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "#4b5563", pointerEvents: "none" }} />
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" suppressHydrationWarning style={inputStyle} />
            </div>
          </div>
          <button
            type="submit" disabled={loading || !token} suppressHydrationWarning
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "11px", borderRadius: 8, border: "none",
              background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.9rem",
              cursor: loading || !token ? "default" : "pointer", opacity: loading || !token ? 0.6 : 1,
            }}
          >
            {loading && <Loader2 style={{ width: 15, height: 15 }} className="animate-spin" />}
            {loading ? "Resetting…" : "Reset password"}
          </button>
          <Link href="/login" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: "#9ca3af", fontSize: "0.8rem", textDecoration: "none" }}>
            <ArrowLeft style={{ width: 13, height: 13 }} /> Back to login
          </Link>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
