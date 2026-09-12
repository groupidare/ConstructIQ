"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";

export type PrivacyTab = "policy" | "security" | "rights";

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
        To secure sensitive personal data — including, login credentials, PCAMs (Inventory management), financial data — encryption measures are employed for data &quot;at rest&quot; and during IT-PS transmission via encryption standards (such as TLS for data in transit and AES-256 for storage). Such data has been encrypted and stored in restricted, access-controlled cloud environments.
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

export function PrivacyModal({ initialTab = "policy", onClose }: { initialTab?: PrivacyTab; onClose: () => void }) {
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
