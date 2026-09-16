"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import type { LoginResponse } from "@/types/auth";
import toast from "react-hot-toast";
import {
  Loader2, User, Lock, TrendingUp, Package as BoxIcon,
  ShieldCheck, BarChart2, MapPin, Shield, Package, ShoppingCart, Info,
  Eye, EyeOff,
} from "lucide-react";
import { PrivacyModal, type PrivacyTab } from "@/components/modals/PrivacyModal";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";

const ROLES = [
  { label: "Project Manager", value: "ProjectManager", icon: BarChart2 },
  { label: "Site",            value: "SiteEngineer",   icon: MapPin    },
  { label: "Admin",           value: "Admin",           icon: Shield    },
  { label: "Warehouse",       value: "WarehousePersonnel", icon: Package },
  { label: "Procurement",     value: "ProcurementOfficer", icon: ShoppingCart },
] as const;

const schema = z.object({
  username:     z.string().min(1, "Email / Username is required"),
  password:     z.string().min(1, "Password is required"),
  role:         z.string().min(1, "Please select your role"),
  agreeToTerms: z.boolean().refine((v) => v === true, "You must agree to the Terms and Conditions"),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router  = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading]           = useState(false);
  const [selectedRole, setSelectedRole] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [privacyOpen, setPrivacyOpen]   = useState(false);
  const [privacyTab,  setPrivacyTab]    = useState<PrivacyTab>("policy");

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { agreeToTerms: false, role: "" },
  });

  const handleRoleSelect = (value: string) => {
    setSelectedRole(value);
    setValue("role", value, { shouldValidate: true });
  };

  const onSubmit = async (data: FormValues) => {
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>("/auth/login", {
        username: data.username.trim(),
        password: data.password.trim(),
      });

      if (res.data.user.role !== data.role) {
        toast.error(`Wrong role. Your account role is "${res.data.user.role}".`);
        return;
      }

      setAuth(res.data.user, res.data.token);
      const displayName = res.data.user.role === "Admin" ? "Admin" : res.data.user.firstName;
      toast.success(`Welcome back, ${displayName}!`);
      router.push("/projects");
    } catch (error: unknown) {
      reportLoginError(error);
    } finally {
      setLoading(false);
    }
  };

  function reportLoginError(error: unknown) {
    if (typeof error === "object" && error !== null && "response" in error) {
      const axiosError = error as { response?: { data?: { message?: string }; status?: number } };
      const message = axiosError.response?.data?.message;
      if (message) {
        toast.error(message);
      } else if (axiosError.response?.status === 401) {
        toast.error("Invalid username or password.");
      } else {
        toast.error("Unable to login. Please check your connection and try again.");
      }
    } else {
      toast.error("Unable to login. Please try again.");
    }
  }

  const handleGoogleCredential = async (idToken: string) => {
    if (!selectedRole) {
      toast.error("Select your role before continuing with Google.");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>("/auth/google", { idToken });

      if (res.data.user.role !== selectedRole) {
        toast.error(`Wrong role. Your account role is "${res.data.user.role}".`);
        return;
      }

      setAuth(res.data.user, res.data.token);
      const displayName = res.data.user.role === "Admin" ? "Admin" : res.data.user.firstName;
      toast.success(`Welcome back, ${displayName}!`);
      router.push("/projects");
    } catch (error: unknown) {
      reportLoginError(error);
    } finally {
      setLoading(false);
    }
  };

  function openPrivacy(tab: PrivacyTab) {
    setPrivacyTab(tab);
    setPrivacyOpen(true);
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "1rem",
      background: "linear-gradient(135deg, #0b1120 0%, #0f2040 100%)",
    }}>
      {privacyOpen && <PrivacyModal initialTab={privacyTab} onClose={() => setPrivacyOpen(false)} />}
      {/* Card */}
      <div style={{
        width: "100%",
        maxWidth: "1000px",
        borderRadius: "16px",
        overflow: "hidden",
        display: "flex",
        boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
        minHeight: "640px",
        border: "1px solid rgba(255,255,255,0.06)",
      }}>

        {/* ── LEFT PANEL ── */}
        <div style={{
          width: "45%",
          flexShrink: 0,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "2.5rem",
          backgroundImage: "url(/background.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
          className="hidden lg:flex"
        >
          {/* overlay */}
          <div style={{
            position: "absolute", inset: 0,
            background: "rgba(7, 18, 50, 0.78)",
          }} />

          {/* content */}
          <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>

            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{
                width: 52, height: 52, borderRadius: 12,
                background: "#f97316",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, boxShadow: "0 4px 12px rgba(249,115,22,0.4)",
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <p style={{ color: "#fff", fontWeight: 700, fontSize: "1.2rem", lineHeight: 1.2 }}>ConstructIQ</p>
            </div>

            {/* Headline */}
            <div>
              <h1 style={{ color: "#fff", fontWeight: 800, fontSize: "1.9rem", lineHeight: 1.25, marginBottom: "0.75rem" }}>
                Intelligent Construction<br />Material Management
              </h1>
              <p style={{ color: "#bfdbfe", fontSize: "0.875rem", marginBottom: "2rem", lineHeight: 1.6 }}>
                Predictive analytics, demand forecasting, and waste optimization – in one platform.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {[
                  { Icon: TrendingUp, text: "AI-powered demand forecasting" },
                  { Icon: BoxIcon,    text: "Real-time inventory monitoring" },
                  { Icon: ShieldCheck, text: "Role-based secure access" },
                ].map(({ Icon, text }) => (
                  <div key={text} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: "rgba(249,115,22,0.15)",
                      border: "1px solid rgba(249,115,22,0.35)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon style={{ width: 16, height: 16, color: "#fb923c" }} />
                    </div>
                    <span style={{ color: "#dbeafe", fontSize: "0.875rem" }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <p style={{ color: "#93c5fd", fontSize: "0.7rem", textAlign: "center", lineHeight: 1.6 }}>
              Developed by Group 11 Capstone ConstructIQ Team<br />© 2026 All Rights Reserved
            </p>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={{
          flex: 1,
          background: "#0d1526",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "2.5rem 2rem",
          overflowY: "auto",
        }}>
          <div style={{ maxWidth: 360, margin: "0 auto", width: "100%" }}>

            {/* Header */}
            <div style={{ marginBottom: "1.5rem" }}>
              <h2 style={{ color: "#fb923c", fontWeight: 700, fontSize: "1.6rem", marginBottom: "0.25rem" }}>
                Welcome back!
              </h2>
              <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>Sign in to your workspace</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

              {/* Email */}
              <div>
                <label style={{ display: "block", color: "#d1d5db", fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.375rem" }}>
                  Email address
                </label>
                <div style={{ position: "relative" }}>
                  <User style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "#4b5563", pointerEvents: "none" }} />
                  <input
                    {...register("username")}
                    suppressHydrationWarning
                    placeholder="yourname@constructiq.com"
                    autoComplete="username"
                    style={{
                      width: "100%", boxSizing: "border-box",
                      paddingLeft: 40, paddingRight: 16, paddingTop: 10, paddingBottom: 10,
                      borderRadius: 8, background: "#060e1e",
                      border: "1px solid #1e3a5f", color: "#fff",
                      fontSize: "0.875rem", outline: "none",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "#3b82f6")}
                    onBlur={e  => (e.currentTarget.style.borderColor = "#1e3a5f")}
                  />
                </div>
                {errors.username && <p style={{ color: "#f87171", fontSize: "0.75rem", marginTop: 4 }}>{errors.username.message}</p>}
              </div>

              {/* Password */}
              <div>
                <label style={{ display: "block", color: "#d1d5db", fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.375rem" }}>
                  Password
                </label>
                <div style={{ position: "relative" }}>
                  <Lock style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "#4b5563", pointerEvents: "none" }} />
                  <input
                    {...register("password")}
                    suppressHydrationWarning
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••••••"
                    autoComplete="current-password"
                    style={{
                      width: "100%", boxSizing: "border-box",
                      paddingLeft: 40, paddingRight: 40, paddingTop: 10, paddingBottom: 10,
                      borderRadius: 8, background: "#060e1e",
                      border: "1px solid #1e3a5f", color: "#fff",
                      fontSize: "0.875rem", outline: "none",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "#3b82f6")}
                    onBlur={e  => (e.currentTarget.style.borderColor = "#1e3a5f")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
                  >
                    {showPassword
                      ? <EyeOff style={{ width: 16, height: 16, color: "#4b5563" }} />
                      : <Eye style={{ width: 16, height: 16, color: "#4b5563" }} />}
                  </button>
                </div>
                {errors.password && <p style={{ color: "#f87171", fontSize: "0.75rem", marginTop: 4 }}>{errors.password.message}</p>}
              </div>

              {/* Role Selection */}
              <div>
                <p style={{ color: "#4b5563", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                  Role Detected
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {ROLES.map(({ label, value, icon: Icon }) => {
                    const active = selectedRole === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleRoleSelect(value)}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "6px 12px", borderRadius: 999,
                          fontSize: "0.75rem", fontWeight: 600,
                          cursor: "pointer", transition: "all 0.15s",
                          background: active ? "#fff"     : "#162035",
                          color:      active ? "#0d1526"  : "#64748b",
                          border:     active ? "1px solid #fff" : "1px solid #253554",
                        }}
                      >
                        <Icon style={{ width: 12, height: 12 }} />
                        {label}
                      </button>
                    );
                  })}
                </div>
                {errors.role && <p style={{ color: "#f87171", fontSize: "0.75rem", marginTop: 4 }}>{errors.role.message}</p>}
                <p style={{ display: "flex", alignItems: "flex-start", gap: 6, color: "#6b7280", fontSize: "0.72rem", marginTop: "0.5rem", lineHeight: 1.5 }}>
                  <Info style={{ width: 12, height: 12, marginTop: 2, flexShrink: 0 }} />
                  Your System Overview is automatically configured based on your assigned role.
                </p>
              </div>

              {/* T&C */}
              <div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <input
                    {...register("agreeToTerms")}
                    suppressHydrationWarning
                    type="checkbox"
                    id="terms"
                    style={{ marginTop: 2, width: 14, height: 14, accentColor: "#f97316", flexShrink: 0, cursor: "pointer" }}
                  />
                  <label htmlFor="terms" style={{ color: "#9ca3af", fontSize: "0.75rem", cursor: "pointer", userSelect: "none", lineHeight: 1.5 }}>
                    I agree to the{" "}
                    <button type="button" onClick={() => openPrivacy("rights")} style={{ color: "#fb923c", background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", padding: 0, fontFamily: "inherit", textDecoration: "none" }}
                      onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
                      onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}>
                      Terms and Conditions
                    </button>{" "}and{" "}
                    <button type="button" onClick={() => openPrivacy("policy")} style={{ color: "#fb923c", background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", padding: 0, fontFamily: "inherit", textDecoration: "none" }}
                      onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
                      onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}>
                      Privacy Policy
                    </button>.
                  </label>
                </div>
                {errors.agreeToTerms && <p style={{ color: "#f87171", fontSize: "0.75rem", marginTop: 4 }}>{errors.agreeToTerms.message}</p>}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%", padding: "12px",
                  borderRadius: 8, border: "none",
                  background: "#1a3a6b", color: "#fff",
                  fontWeight: 700, fontSize: "0.95rem",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.6 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = "0.85"; }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.opacity = "1"; }}
              >
                {loading ? <Loader2 style={{ width: 18, height: 18, animation: "spin 1s linear infinite" }} /> : "Sign in to ConstructIQ"}
              </button>

              {/* Google sign-in — same role check as above, for an existing admin-provisioned account */}
              {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0.25rem 0" }}>
                    <div style={{ flex: 1, height: 1, background: "#1e3a5f" }} />
                    <span style={{ color: "#4b5563", fontSize: "0.7rem", fontWeight: 600 }}>OR</span>
                    <div style={{ flex: 1, height: 1, background: "#1e3a5f" }} />
                  </div>
                  <GoogleSignInButton onCredential={handleGoogleCredential} disabled={loading} />
                </>
              )}

              {/* Links */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem" }}>
                <Link href="/forgot-password" style={{ color: "#fb923c", textDecoration: "none" }}>Forgot password?</Link>
                <span style={{ color: "#6b7280" }}>
                  Need Access?{" "}
                  <a href="#" style={{ color: "#fb923c", textDecoration: "none" }}>Contact Admin</a>
                </span>
              </div>

              {/* Secure notice */}
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                padding: "12px 14px", borderRadius: 8,
                background: "#111d30", border: "1px solid #1e3a5f",
              }}>
                <Lock style={{ width: 16, height: 16, color: "#6b7280", flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ color: "#d1d5db", fontWeight: 600, fontSize: "0.8rem", marginBottom: 2 }}>Secure access</p>
                  <p style={{ color: "#6b7280", fontSize: "0.75rem", lineHeight: 1.5 }}>
                    Self-registration is disabled. Accounts are provisioned by your System Administrator only.
                  </p>
                </div>
              </div>

            </form>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
