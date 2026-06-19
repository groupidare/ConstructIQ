"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import type { LoginResponse } from "@/types/auth";
import toast from "react-hot-toast";
import {
  Loader2, User, Lock, TrendingUp, Package as BoxIcon,
  ShieldCheck, BarChart2, MapPin, Shield, Package, ShoppingCart, Info, X, AlertCircle,
} from "lucide-react";

// ── Data Privacy & Security Notice Modal ─────────────────────────────────────

type PrivacyTab = "policy" | "security" | "rights";

const PRIVACY_TABS: { id: PrivacyTab; label: string; emoji: string }[] = [
  { id: "policy",   label: "Data Privacy Policy",  emoji: "📋" },
  { id: "security", label: "Security Measures",     emoji: "🛡️" },
  { id: "rights",   label: "Your Rights",           emoji: "⚖️" },
];

const PRIVACY_CONTENT: Record<PrivacyTab, React.ReactNode> = {
  policy: (
    <div>
      <h3 style={{ fontWeight:700, fontSize:"0.95rem", color:"#f1f5f9", marginBottom:"0.75rem" }}>
        Data Privacy Act of 2012 (RA 10173) — Compliance Notice
      </h3>
      <p style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75, marginBottom:"1.25rem" }}>
        You have the right to dispute inaccuracies in your personal data and have the information corrected or completed accordingly. The System Administrator shall consider the disputed personal data as non-existent until such time as appropriate modifications or corrections have been made.
      </p>
      <h4 style={{ color:"#f97316", fontWeight:700, fontSize:"0.88rem", marginBottom:"0.5rem" }}>Right to Privacy / Blocking</h4>
      <p style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75, marginBottom:"1.25rem" }}>
        You may request restriction or blocking of your personal data when it is no longer necessary for collection purposes or where content is withheld in an action. Certain data may be retained where required by law or as necessary for statistical research.
      </p>
      <h4 style={{ color:"#f97316", fontWeight:700, fontSize:"0.88rem", marginBottom:"0.5rem" }}>Right to Data Portability</h4>
      <p style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75, marginBottom:"1.25rem" }}>
        You have the right to obtain a copy of your personal data in a structured, commonly-used, machine-readable format if appropriate. You have the right to request direct transmission to another data provider, if feasible.
      </p>
      <h4 style={{ color:"#f97316", fontWeight:700, fontSize:"0.88rem", marginBottom:"0.5rem" }}>Right to Lodge a Complaint</h4>
      <p style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75 }}>
        If your rights have been violated you may lodge a complaint with the System Administrator or file a complaint with the courts or with the National Privacy Commission, whichever is applicable, under the prescribed procedures of the law. This right exists regardless of any other administrative or judicial remedy available.
      </p>
    </div>
  ),
  security: (
    <div>
      <h3 style={{ fontWeight:700, fontSize:"0.95rem", color:"#f1f5f9", marginBottom:"0.75rem" }}>
        Your Rights Under RA 10173 (Data Privacy Act of 2012)
      </h3>
      <p style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75, marginBottom:"1.25rem" }}>
        You have the right to be informed whether your personal data is being processed or not. This includes confirmation whether personal data pertaining to you shall be, are being, or have been processed (including the existence of automated decision-making and profiling), as well as the purposes of processing. You have the right to access, review, and obtain copies of personal data that is being processed; and/or to inquire about the identity of persons who have been provided copies of your personal data.
      </p>
      <h4 style={{ color:"#f97316", fontWeight:700, fontSize:"0.88rem", marginBottom:"0.5rem" }}>Right to Correction / Rectification</h4>
      <p style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75, marginBottom:"1.25rem" }}>
        You have the right to correct and update all your personal data and request corrections. The System Administrator will perform the requested changes within a timeframe specified in the data processing or storage agreement.
      </p>
      <h4 style={{ color:"#f97316", fontWeight:700, fontSize:"0.88rem", marginBottom:"0.5rem" }}>Right to Erasure / Blocking</h4>
      <p style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75, marginBottom:"1.25rem" }}>
        You may request deletion or blocking of your personal data when it is no longer necessary for collection purposes or where consent is withdrawn in an action. Data may still be retained where required by law. The right does not override legal, regulatory, or contractual restrictions.
      </p>
      <h4 style={{ color:"#f97316", fontWeight:700, fontSize:"0.88rem", marginBottom:"0.5rem" }}>Right to Data Portability</h4>
      <p style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75 }}>
        If you are a subject of a Data Privacy Notice → Security Policy, you ultimately consent to the collection and processing of all of your personal data in accordance with the NDPA and all relevant statutes, regulations, and guidelines. This consent is given freely and may be withdrawn at any time through a written request to the System Administrator.
      </p>
    </div>
  ),
  rights: (
    <div>
      <h3 style={{ fontWeight:700, fontSize:"0.95rem", color:"#f1f5f9", marginBottom:"0.75rem" }}>
        Security Measures
      </h3>
      <p style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75, marginBottom:"1.25rem" }}>
        Below are just some of our Data Privacy Notice → Security Policy measures in compliance with the law: We have implemented strong technical and organizational measures to protect your personal data.
      </p>
      <h4 style={{ color:"#f97316", fontWeight:700, fontSize:"0.88rem", marginBottom:"0.5rem" }}>Data Encryption</h4>
      <p style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75, marginBottom:"1.25rem" }}>
        To secure sensitive personal data — including, login credentials, PCAMs (Inventory management), financial data — encryption measures are employed for data "at rest" and during IT-PS transmission via encryption standards (such as TLS for data in transit and AES-256 for storage). Such data has been encrypted and stored in restricted, access-controlled cloud environments.
      </p>
      <h4 style={{ color:"#f97316", fontWeight:700, fontSize:"0.88rem", marginBottom:"0.5rem" }}>Access Controls</h4>
      <p style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75, marginBottom:"1.25rem" }}>
        Access to relevant resource and data is strictly limited by assigned authentication through role-based access controls (RBAC), ensuring that only authorized System Administrator such have permission to view or alter sensitive data. Authentication uses two-factor authentication to further secure administrative-level accounts and endpoints.
      </p>
      <h4 style={{ color:"#f97316", fontWeight:700, fontSize:"0.88rem", marginBottom:"0.5rem" }}>Audit Logging &amp; Monitoring</h4>
      <p style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75 }}>
        We conduct log monitoring to proactively capture unusual patterns, log-ins, configuration adjustments, user activity modifications — are recorded in tamper-evident audit logs. These logs undergo routine review to ensure timely identification of any abnormal behavior or potential security breaches, maintaining system integrity and regulatory compliance.
      </p>
    </div>
  ),
};

function PrivacyModal({ initialTab, onClose }: { initialTab: PrivacyTab; onClose: () => void }) {
  const [tab, setTab] = useState<PrivacyTab>(initialTab);
  return (
    <div
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:3000, display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:"#1e2a3a", borderRadius:14, width:"100%", maxWidth:600, boxShadow:"0 24px 60px rgba(0,0,0,0.5)", overflow:"hidden", maxHeight:"90vh", display:"flex", flexDirection:"column" }}
      >
        {/* Header */}
        <div style={{ padding:"1.1rem 1.25rem", display:"flex", alignItems:"center", gap:10, borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ width:32, height:32, borderRadius:"50%", background:"rgba(249,115,22,0.2)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <AlertCircle style={{ width:17, height:17, color:"#f97316" }} />
          </div>
          <span style={{ fontWeight:700, fontSize:"0.95rem", color:"#f1f5f9", flex:1 }}>Data Privacy &amp; Security Notice</span>
          <button onClick={onClose} style={{ padding:"4px 12px", borderRadius:6, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"#94a3b8", fontSize:"0.78rem", cursor:"pointer" }}>Close</button>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
          {PRIVACY_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex:1, padding:"0.75rem 0.5rem", border:"none", background:"transparent",
                color: tab === t.id ? "#f1f5f9" : "#64748b",
                fontWeight: tab === t.id ? 700 : 500,
                fontSize:"0.78rem", cursor:"pointer",
                borderBottom: tab === t.id ? "2px solid #f97316" : "2px solid transparent",
                transition:"all 0.15s",
              }}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding:"1.25rem", overflowY:"auto", flex:1 }}>
          {PRIVACY_CONTENT[tab]}
        </div>
      </div>
    </div>
  );
}

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
        username: data.username,
        password: data.password,
      });

      if (res.data.user.role !== data.role) {
        toast.error(`Wrong role. Your account role is "${res.data.user.role}".`);
        return;
      }

      setAuth(res.data.user, res.data.token);
      toast.success(`Welcome back, ${res.data.user.firstName}!`);
      router.push("/dashboard");
    } catch {
      toast.error("Invalid username or password.");
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
          backgroundImage: "url(/background.svg)",
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.svg" alt="ConstructIQ" style={{ width: 28, height: 28 }} />
              </div>
              <div>
                <p style={{ color: "#fff", fontWeight: 700, fontSize: "1.2rem", lineHeight: 1.2 }}>ConstructIQ</p>
                <p style={{ color: "#93c5fd", fontSize: "0.75rem" }}>company name</p>
              </div>
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
                    type="password"
                    placeholder="••••••••••••••"
                    autoComplete="current-password"
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
                {errors.password && <p style={{ color: "#f87171", fontSize: "0.75rem", marginTop: 4 }}>{errors.password.message}</p>}
              </div>

              {/* Remember me */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input suppressHydrationWarning type="checkbox" id="remember" style={{ width: 14, height: 14, accentColor: "#f97316", cursor: "pointer" }} />
                <label htmlFor="remember" style={{ color: "#9ca3af", fontSize: "0.75rem", cursor: "pointer", userSelect: "none" }}>
                  Remember me
                </label>
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

              {/* Links */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem" }}>
                <a href="#" style={{ color: "#fb923c", textDecoration: "none" }}>Forgot password?</a>
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
