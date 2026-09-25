"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { FileText, LifeBuoy } from "lucide-react";
import { PrivacyModal } from "@/components/modals/PrivacyModal";

const GRID_STYLE = `
  .landing-hero {
    background-color: #f5ede0;
    background-image:
      linear-gradient(rgba(160,130,100,0.15) 1px, transparent 1px),
      linear-gradient(90deg, rgba(160,130,100,0.15) 1px, transparent 1px);
    background-size: 40px 40px;
    width: 100%;
  }
  .landing-hero-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 5rem 2rem 4rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-height: calc(100vh - 64px);
  }
  .landing-why {
    background: #ffffff;
    width: 100%;
  }
  .landing-why-inner {
    max-width: 1100px;
    margin: 0 auto;
    padding: 5rem 2rem;
  }
  .why-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1.5rem;
  }
  .landing-cta {
    background-color: #f5ede0;
    background-image:
      linear-gradient(rgba(160,130,100,0.1) 1px, transparent 1px),
      linear-gradient(90deg, rgba(160,130,100,0.1) 1px, transparent 1px);
    background-size: 40px 40px;
    width: 100%;
  }
  .landing-cta-inner {
    max-width: 1100px;
    margin: 0 auto;
    padding: 5rem 2rem;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 3rem;
    align-items: center;
  }
  .landing-footer {
    background: #1a2235;
    width: 100%;
  }
  .landing-footer-inner {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem;
  }
  .footer-meta-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1rem;
  }
  .footer-links button { font-size: 0.85rem; color: #9ca3af; background: none; border: none; cursor: pointer; padding: 0; font-family: inherit; transition: color 0.15s; }
  .footer-links button:hover { color: #f97316; }
  @media (max-width: 640px) {
    .footer-meta-row { grid-template-columns: 1fr; text-align: center; gap: 0.4rem; }
  }
  .nav-links { display: flex; gap: 32px; }
  .nav-links button { font-size: 0.9rem; color: #374151; background: none; border: none; cursor: pointer; font-weight: 500; transition: color 0.15s; font-family: inherit; padding: 0; }
  .nav-links button:hover { color: #f97316; }
  @media (max-width: 900px) {
    .why-grid { grid-template-columns: repeat(2, 1fr); }
    .landing-cta-inner { grid-template-columns: 1fr; }
    .cta-logo { display: none !important; }
  }
  @media (max-width: 640px) {
    .nav-links { display: none; }
    .landing-hero-inner { padding: 3rem 1.25rem 3rem; }
    .landing-cta-inner { padding: 3rem 1.25rem; }
    .landing-why-inner { padding: 3rem 1.25rem; }
    .why-grid { grid-template-columns: 1fr 1fr; }
  }
`;

function DarkBtn({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "13px 30px", borderRadius: 9, border: "none", cursor: "pointer",
      background: "#1a2235", color: "#fff", fontWeight: 700, fontSize: "0.95rem",
      transition: "opacity 0.15s", letterSpacing: "0.01em",
    }}
      onMouseEnter={e => (e.currentTarget.style.opacity = "0.82")}
      onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
    >{label}</button>
  );
}

// ── Terms of Use Modal ───────────────────────────────────────────────────────

function ModalShell({ icon: Icon, title, onClose, children }: {
  icon: typeof FileText; title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:3000, display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"#1e2a3a", borderRadius:14, width:"100%", maxWidth:600, boxShadow:"0 24px 60px rgba(0,0,0,0.5)", overflow:"hidden", maxHeight:"90vh", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"1.1rem 1.25rem", display:"flex", alignItems:"center", gap:10, borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ width:32, height:32, borderRadius:"50%", background:"rgba(249,115,22,0.2)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Icon style={{ width:17, height:17, color:"#f97316" }} />
          </div>
          <span style={{ fontWeight:700, fontSize:"0.95rem", color:"#f1f5f9", flex:1 }}>{title}</span>
          <button onClick={onClose} style={{ padding:"4px 12px", borderRadius:6, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"#94a3b8", fontSize:"0.78rem", cursor:"pointer" }}>Close</button>
        </div>
        <div style={{ padding:"1.25rem", overflowY:"auto", flex:1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

const modalH = { color:"#f97316", fontWeight:700, fontSize:"0.88rem", marginTop:"1.25rem", marginBottom:"0.5rem" } as const;
const modalP = { fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75 } as const;
const modalUl = { fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.75, margin:"0.5rem 0 0", paddingLeft:"1.1rem" } as const;

function TermsModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell icon={FileText} title="Terms of Use" onClose={onClose}>
      <p style={modalP}>
        Welcome to CONSTRUCTIQ, a smart construction material demand forecasting and excess
        material optimization system. By accessing or using CONSTRUCTIQ, you agree to comply
        with and be bound by these Terms of Use. If you do not agree with these terms, please
        do not use the system.
      </p>

      <h4 style={modalH}>Acceptance of Terms</h4>
      <p style={modalP}>
        By accessing and using CONSTRUCTIQ, you acknowledge that you have read, understood,
        and agreed to these Terms of Use. These terms apply to all authorized users of the system.
      </p>

      <h4 style={modalH}>Purpose of the System</h4>
      <p style={modalP}>
        CONSTRUCTIQ is designed to assist authorized personnel in managing construction material
        information, monitoring inventory, forecasting material demand, and identifying excess
        materials through data-driven analytics and predictive models.
      </p>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        The system is intended to support, and not replace, the judgment and decision-making of
        authorized personnel.
      </p>

      <h4 style={modalH}>Authorized Use</h4>
      <p style={modalP}>
        CONSTRUCTIQ is intended only for authorized users of the organization. Users may access
        the system only according to their assigned roles and permissions.
      </p>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        Users are responsible for ensuring that their use of the system is limited to legitimate
        business, operational, research, or administrative purposes.
      </p>

      <h4 style={modalH}>User Accounts and Responsibilities</h4>
      <p style={modalP}>
        Users are responsible for maintaining the confidentiality of their account credentials,
        including usernames, passwords, and verification codes.
      </p>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>Users must:</p>
      <ul style={modalUl}>
        <li>Provide accurate information when required.</li>
        <li>Keep their login credentials confidential.</li>
        <li>Avoid sharing their account with other individuals.</li>
        <li>Log out after using the system, especially when accessing it on a shared device.</li>
        <li>Immediately report suspected unauthorized access or security incidents to the system administrator.</li>
      </ul>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        Users may be held responsible for activities performed through their accounts when such
        activities result from negligence or unauthorized sharing of credentials.
      </p>

      <h4 style={modalH}>Prohibited Activities</h4>
      <p style={modalP}>Users are prohibited from:</p>
      <ul style={modalUl}>
        <li>Accessing information or features without proper authorization.</li>
        <li>Using another person&apos;s account.</li>
        <li>Attempting to bypass or disable system security measures.</li>
        <li>Altering, deleting, or manipulating records without authorization.</li>
        <li>Uploading malicious files, software, or code.</li>
        <li>Attempting to disrupt, damage, or interfere with the operation of the system.</li>
        <li>Using the system for unlawful or unauthorized purposes.</li>
        <li>Sharing confidential company or project information with unauthorized individuals.</li>
        <li>Copying, modifying, or distributing system components without proper authorization.</li>
      </ul>

      <h4 style={modalH}>Data and Information</h4>
      <p style={modalP}>
        Users must ensure that information entered into CONSTRUCTIQ is accurate, complete, and
        appropriate for its intended purpose.
      </p>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        The organization and authorized personnel are responsible for verifying important records
        before using them for operational, procurement, inventory, or project-related decisions.
      </p>

      <h4 style={modalH}>Forecasting and Analytics Disclaimer</h4>
      <p style={modalP}>
        CONSTRUCTIQ may generate demand forecasts, analytics, recommendations, and other
        system-generated results using historical and available data.
      </p>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        These results are intended to serve as <strong>decision-support</strong> information and
        should not be considered guaranteed outcomes or exact predictions.
      </p>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        Forecast results may vary depending on the quality, completeness, and availability of the
        data provided to the system. Users and authorized personnel should review and validate
        system-generated results before making important procurement, inventory, or
        construction-related decisions.
      </p>

      <h4 style={modalH}>Third-Party Services</h4>
      <p style={modalP}>
        CONSTRUCTIQ may use third-party services or APIs to support certain system functions,
        such as data integration, weather information, email notifications, or other external
        services.
      </p>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        The availability and functionality of third-party services may be affected by changes,
        interruptions, limitations, or policies imposed by their respective providers.
      </p>

      <h4 style={modalH}>System Availability</h4>
      <p style={modalP}>
        While reasonable efforts may be made to keep CONSTRUCTIQ available and operational,
        continuous or uninterrupted access cannot be guaranteed. The system may become
        temporarily unavailable due to maintenance, updates, technical problems, network
        interruptions, server issues, or third-party service disruptions.
      </p>

      <h4 style={modalH}>Data Security</h4>
      <p style={modalP}>
        Reasonable security measures are implemented to help protect information stored and
        processed by CONSTRUCTIQ. However, no electronic system can guarantee complete
        protection against all possible security threats.
      </p>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        Users are expected to follow appropriate security practices and immediately report
        suspected security incidents to the system administrator.
      </p>

      <h4 style={modalH}>Intellectual Property</h4>
      <p style={modalP}>
        The CONSTRUCTIQ name, system design, interface, software components, documentation, and
        other original materials associated with the system are protected by applicable
        intellectual property laws and are intended for authorized use only.
      </p>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        No part of the system may be reproduced, distributed, modified, or used for unauthorized
        purposes without proper permission.
      </p>

      <h4 style={modalH}>Privacy</h4>
      <p style={modalP}>
        The collection, processing, storage, and use of personal information through CONSTRUCTIQ
        are subject to the system&apos;s Privacy Policy.
      </p>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        Users are encouraged to review the Privacy Policy to understand how their information is
        handled and protected.
      </p>

      <h4 style={modalH}>Changes to the System and Terms</h4>
      <p style={modalP}>
        CONSTRUCTIQ may be updated, modified, or improved from time to time. Features, functions,
        and system requirements may change as necessary.
      </p>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        These Terms of Use may also be updated when necessary. Users will be expected to comply
        with the latest version of the terms when continuing to use the system.
      </p>

      <h4 style={modalH}>Limitation of Responsibility</h4>
      <p style={modalP}>
        CONSTRUCTIQ is provided as a decision-support and management system. The developers and
        system administrators are not responsible for decisions made solely based on
        system-generated forecasts, recommendations, analytics, or other information without
        appropriate review and validation by authorized personnel.
      </p>

      <h4 style={modalH}>Termination of Access</h4>
      <p style={modalP}>
        Access to CONSTRUCTIQ may be suspended or terminated if a user violates these Terms of
        Use, misuses the system, accesses information without authorization, or engages in
        activities that may compromise the security or proper operation of the system.
      </p>

      <h4 style={modalH}>Contact and Support</h4>
      <p style={modalP}>
        For questions, concerns, technical issues, or reports regarding the use of CONSTRUCTIQ,
        users should contact the designated system administrator or authorized organization
        representative.
      </p>
    </ModalShell>
  );
}

// ── Contact Support Modal ────────────────────────────────────────────────────

function ContactSupportModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell icon={LifeBuoy} title="Contact Support" onClose={onClose}>
      <p style={modalP}>
        Need help with CONSTRUCTIQ? Our support team is available to assist with account
        concerns, system issues, and other questions related to the use of the system.
      </p>

      <h4 style={modalH}>How Can We Help?</h4>
      <p style={modalP}>You may contact support for concerns regarding:</p>
      <ul style={modalUl}>
        <li>Account login and password issues</li>
        <li>OTP and account verification concerns</li>
        <li>User account and access permissions</li>
        <li>Material and inventory records</li>
        <li>Demand forecasting results</li>
        <li>Excess material monitoring</li>
        <li>Reports and analytics</li>
        <li>System errors or technical issues</li>
        <li>Other concerns related to the use of CONSTRUCTIQ</li>
      </ul>

      <h4 style={modalH}>Before Contacting Support</h4>
      <p style={modalP}>When reporting a technical issue, please provide the following information when applicable:</p>
      <ul style={modalUl}>
        <li>Your name or user account</li>
        <li>Date and time when the issue occurred</li>
        <li>Description of the problem</li>
        <li>Screenshot of the error, if available</li>
        <li>Steps taken before the issue occurred</li>
      </ul>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        Please do not include or send your password, OTP, or other confidential login
        credentials when contacting support.
      </p>

      <h4 style={modalH}>Contact Information</h4>
      <p style={{ ...modalP, lineHeight:2 }}>
        System Administrator: BSIT4-2_Group11<br />
        Email: sysadmin@constructiq.com<br />
        Contact Number: 09123456789<br />
        Organization: Skyrise Builders Management Inc.
      </p>

      <h4 style={modalH}>Support Hours</h4>
      <p style={{ ...modalP, lineHeight:2 }}>
        Monday – Friday: 8:00 AM – 5:00 PM<br />
        Saturday: 8:00 AM - 12:00 PM<br />
        Sunday: Closed
      </p>
      <p style={{ ...modalP, marginTop:"0.75rem" }}>
        Response times may vary depending on the nature and urgency of the concern.
      </p>

      <h4 style={modalH}>Important Notice</h4>
      <p style={modalP}>
        For security and privacy reasons, support personnel will never ask you to provide your
        password or OTP. Account-related requests may require verification before any changes
        are made.
      </p>
    </ModalShell>
  );
}

function OrangeBtn({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "13px 30px", borderRadius: 9, border: "none", cursor: "pointer",
      background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.95rem",
      transition: "opacity 0.15s", letterSpacing: "0.01em",
    }}
      onMouseEnter={e => (e.currentTarget.style.opacity = "0.88")}
      onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
    >{label}</button>
  );
}

type FooterModal = "privacy" | "terms" | "contact" | null;

export default function LandingPage() {
  const router  = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [footerModal, setFooterModal] = useState<FooterModal>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function goLogin() { router.push("/login"); }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  function playVideo() {
    videoRef.current?.play();
  }

  return (
    <>
      <style>{GRID_STYLE}</style>
      {footerModal === "privacy" && <PrivacyModal onClose={() => setFooterModal(null)} />}
      {footerModal === "terms"   && <TermsModal onClose={() => setFooterModal(null)} />}
      {footerModal === "contact" && <ContactSupportModal onClose={() => setFooterModal(null)} />}
      <div style={{ fontFamily: "'Inter','Segoe UI',sans-serif", color: "#111827", width: "100%", overflowX: "hidden" }}>

        {/* ── NAVBAR ── */}
        <nav style={{
          position: "sticky", top: 0, zIndex: 200,
          width: "100%", height: 64,
          background: "#ffffff",
          boxShadow: scrolled ? "0 2px 16px rgba(0,0,0,0.09)" : "0 1px 0 #e5e7eb",
          transition: "box-shadow 0.2s",
          display: "flex", alignItems: "center",
        }}>
          <div style={{ maxWidth: 1200, width: "100%", margin: "0 auto", padding: "0 2rem", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: "1rem" }}>
            {/* Logo — left */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, background: "#f97316",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 4px 14px rgba(249,115,22,0.38)", flexShrink: 0,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <span style={{ fontWeight: 800, fontSize: "1.1rem", color: "#111827", letterSpacing: "-0.01em" }}>ConstructIQ</span>
            </div>

            {/* Nav links — true center */}
            <div className="nav-links">
              <button onClick={() => scrollTo("home")}>Home</button>
              <button onClick={() => scrollTo("help")}>About Us</button>
              <button onClick={() => scrollTo("footer")}>Contact</button>
            </div>

            {/* Auth buttons — right */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end" }}>
              <button onClick={goLogin} style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#f97316", fontWeight: 700, fontSize: "0.9rem", padding: "6px 4px",
              }}>Login</button>
              <button onClick={goLogin} style={{
                padding: "9px 20px", borderRadius: 8, border: "none", cursor: "pointer",
                background: "#1a2235", color: "#fff", fontWeight: 700, fontSize: "0.875rem",
                transition: "opacity 0.15s",
              }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.82")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
              >Get ConstructIQ</button>
            </div>
          </div>
        </nav>

        {/* ── HERO ── */}
        <section id="home" className="landing-hero">
          <div className="landing-hero-inner">
            <h1 style={{
              fontSize: "clamp(2.8rem, 5vw, 4.5rem)", fontWeight: 900,
              lineHeight: 1.05, marginBottom: "1.75rem", maxWidth: 720,
            }}>
              <span style={{ color: "#1a2235", display: "block" }}>Smarter Materials.</span>
              <span style={{ color: "#f97316", fontStyle: "italic", display: "block" }}>Zero Waste.</span>
              <span style={{ color: "#1a2235", display: "block" }}>Built for Construction.</span>
            </h1>

            <p style={{
              fontSize: "clamp(0.88rem, 1.5vw, 1rem)", color: "#4b5563",
              lineHeight: 1.8, maxWidth: 500, marginBottom: "2.25rem",
            }}>
              ConstructIQ is an AI-powered Progressive Web App that forecasts material demand,
              optimizes procurement, tracks waste, and reduces cost overruns for Philippine
              construction projects.
            </p>

            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "3.5rem" }}>
              <DarkBtn label="Get Started" onClick={() => scrollTo("help")} />
              <OrangeBtn label="Sign Up" onClick={goLogin} />
            </div>

            {/* Video tutorial card */}
            <div style={{
              width: "100%", maxWidth: 560,
              border: "3px solid #1a2235", borderRadius: 16,
              overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.14)",
            }}>
              <div style={{ background: "#dde0f0", padding: "1.75rem", display: "flex", gap: "1.5rem", alignItems: "flex-start" }}>
                {/* Left copy */}
                <div style={{ flex: "0 0 190px" }}>
                  <h3 style={{ fontSize: "1.75rem", fontWeight: 900, color: "#111827", lineHeight: 1.1, marginBottom: "0.85rem" }}>
                    Construction Intelligence
                  </h3>
                  <p style={{ fontSize: "0.72rem", color: "#6b7280", lineHeight: 1.65, marginBottom: "1rem" }}>
                    Experience how automated material management and real-time insights
                    bring complex building projects to life.
                  </p>
                  <button onClick={playVideo} style={{
                    padding: "7px 18px", borderRadius: 6, border: "none", cursor: "pointer",
                    background: "#3b82f6", color: "#fff", fontSize: "0.78rem", fontWeight: 600,
                  }}>Watch Overview</button>
                </div>
                {/* Right — real product walkthrough video */}
                <div style={{ flex: 1 }}>
                  <video
                    ref={videoRef}
                    src="/landing-video.mp4"
                    controls
                    preload="metadata"
                    style={{ width: "100%", display: "block", borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.1)", background: "#000" }}
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── WHY CONSTRUCTIQ ── */}
        <section id="help" className="landing-why">
          <div className="landing-why-inner">
            <h2 style={{ fontSize: "clamp(1.5rem, 2.5vw, 2rem)", fontWeight: 900, marginBottom: "2.5rem" }}>
              <span style={{ color: "#f97316" }}>Why</span>{" "}
              <span style={{ color: "#1a2235" }}>ConstructIQ</span>{" "}
              <span style={{ color: "#f97316" }}>?</span>
            </h2>
            <div className="why-grid">
              {[
                { title: "Accurate Material\nDemand Forecasting", desc: "Predicts material demand accurately for better planning.",    dark: true  },
                { title: "Excess Optimization",                   desc: "Minimizes excess materials and improves resource utilization.", dark: false },
                { title: "Smart\nDecision-Making",                desc: "Provides data-driven insights for better decisions.",        dark: true  },
                { title: "Improved\nProductivity",                desc: "Automates processes to save time and increase efficiency.", dark: false },
              ].map(card => (
                <div key={card.title} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div style={{
                    padding: "1.25rem 1rem", borderRadius: 10,
                    background: card.dark ? "#1a2235" : "#f97316",
                    color: "#fff", fontWeight: 700, fontSize: "0.92rem",
                    lineHeight: 1.35, textAlign: "center", minHeight: 90,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    whiteSpace: "pre-line",
                  }}>{card.title}</div>
                  <p style={{ fontSize: "0.82rem", color: "#6b7280", textAlign: "center", lineHeight: 1.65 }}>
                    {card.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── TRY FOR FREE ── */}
        <section id="about" className="landing-cta">
          <div className="landing-cta-inner">
            {/* Left */}
            <div>
              <h2 style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)", fontWeight: 900, color: "#f97316", letterSpacing: "-0.02em", marginBottom: "0.5rem", lineHeight: 1 }}>
                TRY FOR FREE
              </h2>
              <h3 style={{ fontSize: "clamp(1rem, 1.8vw, 1.2rem)", fontWeight: 800, color: "#1a2235", marginBottom: "1.25rem" }}>
                Smarter Forecasting, Less Waste, Better Construction.
              </h3>
              <p style={{ fontSize: "0.92rem", color: "#374151", lineHeight: 1.8, maxWidth: 540, marginBottom: "1rem" }}>
                ConstructIQ is the intelligent construction management system designed to improve
                material demand forecasting and reduce waste through predictive analytics.
                Whether you&apos;re planning resources, monitoring material usage, or optimizing
                project decisions, ConstructIQ helps your team work smarter with data-driven
                insights and efficient forecasting tools.
              </p>
              <p style={{ fontSize: "0.88rem", color: "#f97316", fontWeight: 600, marginBottom: "1.75rem" }}>
                Choose ConstructIQ and build with intelligence and precision.
              </p>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <DarkBtn label="Get ConstructIQ" onClick={goLogin} />
              </div>
            </div>

            {/* Right logo */}
            <div className="cta-logo" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landlogo.png" alt="ConstructIQ" style={{ width: 380, height: 380, objectFit: "contain", filter: "drop-shadow(0 10px 30px rgba(0,0,0,0.14))" }} />
            </div>
          </div>
        </section>

        {/* ── FOOTER ── */}
        <footer id="footer" className="landing-footer">
          <div className="landing-footer-inner">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1.5rem" }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "#f97316", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <span style={{ fontWeight: 800, fontSize: "1rem", color: "#fff" }}>ConstructIQ</span>
            </div>

            <div className="footer-meta-row" style={{ marginBottom: "1.25rem" }}>
              <p style={{ fontSize: "0.78rem", color: "#9ca3af" }}>
                © 2026 CONSTRUCTIQ. All rights reserved
              </p>
              <p style={{ fontSize: "0.78rem", color: "#9ca3af", textAlign: "center" }}>
                Developed by BSIT - Polytechnic University of the Philippines - Group 11
              </p>
              <p style={{ fontSize: "0.78rem", color: "#9ca3af", textAlign: "right", justifySelf: "end" }}>
                Version 1.0
              </p>
            </div>

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
              <div className="footer-links" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => setFooterModal("privacy")}>Privacy Policy</button>
                <span style={{ color: "#4b5563" }}>|</span>
                <button onClick={() => setFooterModal("terms")}>Terms of Use</button>
                <span style={{ color: "#4b5563" }}>|</span>
                <button onClick={() => setFooterModal("contact")}>Contact Support</button>
              </div>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
