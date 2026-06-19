"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

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
  .footer-nav { display: flex; gap: 24px; }
  .footer-links a { font-size: 0.85rem; color: #9ca3af; text-decoration: none; transition: color 0.15s; }
  .footer-links a:hover { color: #f97316; }
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
    .footer-nav { display: none; }
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

export default function LandingPage() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function goLogin() { router.push("/login"); }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <>
      <style>{GRID_STYLE}</style>
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
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <span style={{ fontWeight: 800, fontSize: "1.1rem", color: "#111827", letterSpacing: "-0.01em" }}>ConstructIQ</span>
            </div>

            {/* Nav links — true center */}
            <div className="nav-links">
              <button onClick={() => scrollTo("home")}>Home</button>
              <button onClick={() => scrollTo("about")}>About Us</button>
              <button onClick={() => scrollTo("help")}>Help</button>
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
                    Video<br />tutorials
                  </h3>
                  <p style={{ fontSize: "0.72rem", color: "#6b7280", lineHeight: 1.65, marginBottom: "1rem" }}>
                    Learn how to use ConstructIQ with step-by-step guides covering
                    forecasting, inventory, procurement, and more.
                  </p>
                  <button onClick={goLogin} style={{
                    padding: "7px 18px", borderRadius: 6, border: "none", cursor: "pointer",
                    background: "#3b82f6", color: "#fff", fontSize: "0.78rem", fontWeight: 600,
                  }}>Sign Up</button>
                </div>
                {/* Right — monitor mockup */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: "#fff", borderRadius: 10, padding: "1rem", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}>
                    <div style={{ height: 7, background: "#e5e7eb", borderRadius: 4, marginBottom: 7, width: "90%" }} />
                    <div style={{ height: 7, background: "#e5e7eb", borderRadius: 4, marginBottom: 7, width: "75%" }} />
                    <div style={{ height: 7, background: "#e5e7eb", borderRadius: 4, width: "55%" }} />
                    <div style={{ display: "flex", justifyContent: "center", marginTop: "0.85rem" }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%", background: "#1a2235",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="#fff">
                          <polygon points="3,1 12,6.5 3,12" />
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
                    {["#f97316", "#3b82f6", "#22c55e"].map(c => (
                      <div key={c} style={{ width: 30, height: 30, borderRadius: "50%", background: c, border: "2.5px solid #dde0f0" }} />
                    ))}
                  </div>
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
                { title: "Waste Reduction",                       desc: "Reduces material waste and unnecessary costs.",               dark: false },
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
                <OrangeBtn label="Start Free Trial" onClick={goLogin} />
              </div>
            </div>

            {/* Right logo */}
            <div className="cta-logo" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 240, height: 240, borderRadius: "50%", background: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 10px 40px rgba(0,0,0,0.12)", overflow: "hidden",
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/landlogo.svg" alt="ConstructIQ" style={{ width: 200, height: 200, objectFit: "contain" }} />
              </div>
              <p style={{ fontWeight: 800, fontSize: "1.1rem", color: "#1a2235" }}>ConstructIQ</p>
              <p style={{ fontSize: "0.62rem", color: "#9ca3af", letterSpacing: "0.07em", textAlign: "center" }}>
                SMARTER CONSTRUCTION. INTELLIGENT DECISIONS.
              </p>
            </div>
          </div>
        </section>

        {/* ── FOOTER ── */}
        <footer className="landing-footer">
          <div className="landing-footer-inner">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: "#f97316", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </div>
                <span style={{ fontWeight: 800, fontSize: "1rem", color: "#fff" }}>ConstructIQ</span>
              </div>
              <div className="footer-links footer-nav">
                {["Features", "Roles", "Technology", "Contact"].map(l => (
                  <a key={l} href="#">{l}</a>
                ))}
              </div>
            </div>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                <p style={{ fontSize: "0.78rem", color: "#9ca3af" }}>
                  © 2026 ConstructIQ &nbsp;·&nbsp; Bejic &nbsp;·&nbsp; Castro &nbsp;·&nbsp; Obniala &nbsp;·&nbsp; Peralta
                </p>
                <p style={{ fontSize: "0.72rem", color: "#6b7280", marginTop: 3 }}>
                  College of Computer and Information Sciences &nbsp;·&nbsp; PUP Sta. Mesa, Manila
                </p>
              </div>
              <p style={{ fontSize: "0.78rem", color: "#9ca3af" }}>
                BSiT &nbsp;·&nbsp; Capstone &nbsp;·&nbsp; 2026
              </p>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
