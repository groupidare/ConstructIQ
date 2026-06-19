"use client";

import { useState, useMemo } from "react";
import Header from "@/components/layout/Header";
import {
  LayoutDashboard, TrendingUp, Package, ShoppingCart,
  Trash2, FolderKanban, Users, DollarSign,
  Eye, Download, FileText, Search, Filter, X, Zap, BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

// ── Report definitions ────────────────────────────────────────────────────────

interface Report {
  id: string;
  title: string;
  desc: string;
  icon: React.ElementType;
  date: string;
  category: string;
}

const REPORTS: Report[] = [
  { id:"dashboard",   title:"Dashboard",        desc:"KPI summaries, alerts, overall system health",       icon:LayoutDashboard, date:"Today",   category:"Overview"   },
  { id:"forecasting", title:"Forecasting",       desc:"Demand predictions, model accuracy, shortage risks",  icon:TrendingUp,      date:"Today",   category:"Analytics"  },
  { id:"inventory",   title:"Inventory",         desc:"Stock levels, movements, alerts, shelf-life",         icon:Package,         date:"May 25",  category:"Operations" },
  { id:"procurement", title:"Procurement",       desc:"POs, supplier performance, delivery tracking",        icon:ShoppingCart,    date:"May 24",  category:"Operations" },
  { id:"waste",       title:"Waste Analytics",   desc:"Waste rate, costs, redistribution savings",           icon:Trash2,          date:"May 23",  category:"Analytics"  },
  { id:"projects",    title:"Projects",          desc:"Timeline, budget, material status per project",       icon:FolderKanban,    date:"May 22",  category:"Management" },
  { id:"users",       title:"User Management",   desc:"User activity, logins, role changes, audit log",      icon:Users,           date:"May 20",  category:"Management" },
  { id:"cost",        title:"Cost Impact",       desc:"Waste costs, over-order losses, savings potential",   icon:DollarSign,      date:"May 19",  category:"Analytics"  },
];

// ── Per-report view data ──────────────────────────────────────────────────────

interface ReportViewData {
  subtitle: string;
  stats: { label: string; value: string; sub: string }[];
  chartTitle: string;
  chartData: { name: string; value: number }[];
  healthTitle: string;
  health: { label: string; pct: string; color: string }[];
  aiInsight: string;
}

const VIEW_DATA: Record<string, ReportViewData> = {
  dashboard: {
    subtitle: "System overview · Today",
    stats: [
      { label:"TOTAL ALERTS",      value:"14",   sub:"Require attention"      },
      { label:"AI ACCURACY",       value:"93.4%",sub:"Forecast model"         },
      { label:"COST SAVINGS",      value:"₱248K",sub:"This month"             },
    ],
    chartTitle: "Alert Distribution",
    chartData: [{ name:"Inventory",value:5 },{ name:"Forecast",value:3 },{ name:"Procurement",value:4 },{ name:"Waste",value:2 }],
    healthTitle: "System Health",
    health: [
      { label:"Operational", pct:"87%", color:"#22c55e" },
      { label:"Warning",     pct:"9%",  color:"#f59e0b" },
      { label:"Critical",    pct:"4%",  color:"#ef4444" },
    ],
    aiInsight: "ConstructIQ AI: System performance is stable. Procurement alerts are the primary driver of open issues this week — resolving 3 delayed POs will clear 60% of current alerts.",
  },
  forecasting: {
    subtitle: "Demand predictions & model accuracy · Today",
    stats: [
      { label:"MODEL ACCURACY",    value:"93.4%",sub:"R² score"               },
      { label:"SHORTAGE RISKS",    value:"4",    sub:"Next 30 days"            },
      { label:"FORECAST HORIZON",  value:"90 days",sub:"Prediction window"    },
    ],
    chartTitle: "Demand vs Predicted (units)",
    chartData: [{ name:"Jan",value:3800 },{ name:"Feb",value:4100 },{ name:"Mar",value:4300 },{ name:"Apr",value:4500 },{ name:"May",value:4800 },{ name:"Jun",value:5100 }],
    healthTitle: "Model Performance",
    health: [
      { label:"High Confidence",   pct:"72%", color:"#22c55e" },
      { label:"Moderate",          pct:"21%", color:"#f59e0b" },
      { label:"Low Confidence",    pct:"7%",  color:"#ef4444" },
    ],
    aiInsight: "ConstructIQ AI: Cement and steel demand are trending upward at +18.4% over the next 30 days. Recommend pre-positioning procurement orders for these materials within the next 7 days.",
  },
  inventory: {
    subtitle: "Stock levels, alerts & movements · Today",
    stats: [
      { label:"TOTAL STOCK ITEMS", value:"247",  sub:"Across 5 projects"      },
      { label:"LOW STOCK ALERTS",  value:"12",   sub:"Require reorder"         },
      { label:"OVERSTOCK ITEMS",   value:"5",    sub:"Recommend redistribution"},
    ],
    chartTitle: "Trend Overview",
    chartData: [{ name:"Cement",value:1240 },{ name:"Steel",value:3200 },{ name:"Sand",value:88 },{ name:"Gravel",value:42 },{ name:"CHB",value:4500 },{ name:"Paint",value:320 },{ name:"Lumber",value:280 },{ name:"Rebar",value:600 }],
    healthTitle: "Stock Health",
    health: [
      { label:"Available",   pct:"72%", color:"#22c55e" },
      { label:"In Use",      pct:"17%", color:"#9ca3af" },
      { label:"Damaged",     pct:"6%",  color:"#ef4444" },
      { label:"Expired",     pct:"3%",  color:"#ef4444" },
      { label:"Transferred", pct:"2%",  color:"#9ca3af" },
    ],
    aiInsight: "ConstructIQ AI: Based on current data trends, reviewing procurement schedules and enabling dead stock redistribution can reduce costs in the next 30-day cycle.",
  },
  procurement: {
    subtitle: "Purchase orders & supplier performance · May 24",
    stats: [
      { label:"TOTAL POs",         value:"18",   sub:"This month"             },
      { label:"ON-TIME DELIVERY",  value:"89%",  sub:"Supplier avg"           },
      { label:"PENDING APPROVAL",  value:"3",    sub:"Awaiting sign-off"       },
    ],
    chartTitle: "PO Status Breakdown",
    chartData: [{ name:"Pending",value:3 },{ name:"Approved",value:1 },{ name:"Transit",value:3 },{ name:"Delivered",value:10 },{ name:"Delayed",value:1 }],
    healthTitle: "Supplier Performance",
    health: [
      { label:"PREFERRED",  pct:"60%", color:"#22c55e" },
      { label:"ACTIVE",     pct:"30%", color:"#3b82f6" },
      { label:"AT RISK",    pct:"10%", color:"#ef4444" },
    ],
    aiInsight: "ConstructIQ AI: PO-2025-0839 is 6 days delayed from PhilCon Aggregates. Recommend escalation or alternative sourcing from PolyCon Philippines to avoid site shutdown.",
  },
  waste: {
    subtitle: "Waste rate, costs & redistribution · May 23",
    stats: [
      { label:"EXCESS RATE",       value:"3.8%", sub:"June average"           },
      { label:"EXCESS COST",       value:"₱48k", sub:"This period"            },
      { label:"DEAD STOCK",        value:"6",    sub:"Items flagged"           },
    ],
    chartTitle: "Waste by Project",
    chartData: [{ name:"Metro Stn",value:32000 },{ name:"BGC Tower",value:18000 },{ name:"Harbor",value:38000 },{ name:"Southgate",value:24000 },{ name:"PUP ICTC",value:12000 }],
    healthTitle: "Waste Categories",
    health: [
      { label:"Overordering", pct:"42%", color:"#f97316" },
      { label:"Spoilage",     pct:"28%", color:"#ef4444" },
      { label:"Breakage",     pct:"18%", color:"#f59e0b" },
      { label:"Theft",        pct:"12%", color:"#9ca3af" },
    ],
    aiInsight: "ConstructIQ AI: Harbor Bridge Renovation has the highest waste cost at ₱38k. Reviewing material delivery schedules and on-site storage could reduce waste by an estimated 22%.",
  },
  projects: {
    subtitle: "Project timelines & budget status · May 22",
    stats: [
      { label:"TOTAL PROJECTS",    value:"5",    sub:"Across all sites"       },
      { label:"ON SCHEDULE",       value:"3",    sub:"Active projects"         },
      { label:"BUDGET UTILIZED",   value:"68%",  sub:"Avg across projects"    },
    ],
    chartTitle: "Progress by Project (%)",
    chartData: [{ name:"Metro",value:62 },{ name:"BGC",value:38 },{ name:"Harbor",value:81 },{ name:"Southgate",value:12 },{ name:"PUP ICTC",value:100 }],
    healthTitle: "Project Status",
    health: [
      { label:"Active",    pct:"60%", color:"#22c55e" },
      { label:"Planning",  pct:"20%", color:"#f97316" },
      { label:"Completed", pct:"20%", color:"#9ca3af" },
    ],
    aiInsight: "ConstructIQ AI: Harbor Bridge Renovation is at 81% completion and on track to finish by December 2025. BGC Tower has material procurement risks that may delay Phase 2 by 2-3 weeks.",
  },
  users: {
    subtitle: "User activity, logins & audit log · May 20",
    stats: [
      { label:"ACTIVE USERS",      value:"12",   sub:"This month"             },
      { label:"TOTAL LOGINS",      value:"248",  sub:"Last 30 days"           },
      { label:"ROLE CHANGES",      value:"2",    sub:"Pending review"         },
    ],
    chartTitle: "Login Activity (Last 7 Days)",
    chartData: [{ name:"Mon",value:8 },{ name:"Tue",value:12 },{ name:"Wed",value:6 },{ name:"Thu",value:15 },{ name:"Fri",value:10 },{ name:"Sat",value:3 },{ name:"Sun",value:2 }],
    healthTitle: "User Roles",
    health: [
      { label:"Admin",             pct:"8%",  color:"#f97316" },
      { label:"Project Manager",   pct:"25%", color:"#3b82f6" },
      { label:"Site Engineer",     pct:"33%", color:"#22c55e" },
      { label:"Warehouse",         pct:"25%", color:"#f59e0b" },
      { label:"Procurement",       pct:"9%",  color:"#9ca3af" },
    ],
    aiInsight: "ConstructIQ AI: 2 accounts have been inactive for over 30 days. Recommend deactivating to maintain system security and license compliance.",
  },
  cost: {
    subtitle: "Cost impact & savings analysis · May 19",
    stats: [
      { label:"TOTAL WASTE COST",  value:"₱124k",sub:"This quarter"          },
      { label:"AI COST SAVINGS",   value:"₱248K",sub:"Via optimization"      },
      { label:"OVER-ORDER LOSSES", value:"₱36k", sub:"Last 30 days"          },
    ],
    chartTitle: "Cost Breakdown (₱k)",
    chartData: [{ name:"Waste",value:124 },{ name:"Over-order",value:36 },{ name:"Expired",value:18 },{ name:"Breakage",value:12 },{ name:"Savings",value:248 }],
    healthTitle: "Cost Distribution",
    health: [
      { label:"Procurement", pct:"45%", color:"#3b82f6" },
      { label:"Waste",       pct:"28%", color:"#ef4444" },
      { label:"Labor",       pct:"17%", color:"#f59e0b" },
      { label:"Logistics",   pct:"10%", color:"#9ca3af" },
    ],
    aiInsight: "ConstructIQ AI: Optimizing reorder points across all 5 projects could save ₱62k in the next quarter. Dead stock redistribution from PVC Pipes (2,800 units) is the single highest-impact action available.",
  },
};

// ── PDF generator ─────────────────────────────────────────────────────────────

function generatePDF(report: Report) {
  const data = VIEW_DATA[report.id];
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>ConstructIQ — ${report.title} Report</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; color: #111827; padding: 40px; }
    .header { display:flex; justify-content:space-between; align-items:center; padding-bottom:16px; border-bottom:3px solid #f97316; margin-bottom:24px; }
    .logo { font-size:22px; font-weight:900; color:#f97316; }
    .subtitle { font-size:12px; color:#9ca3af; margin-top:4px; }
    h1 { font-size:20px; color:#111827; margin-bottom:4px; }
    .stats { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:24px; }
    .stat-box { background:#f9fafb; border-radius:8px; padding:16px; border:1px solid #e5e7eb; }
    .stat-label { font-size:10px; color:#9ca3af; text-transform:uppercase; letter-spacing:.05em; }
    .stat-value { font-size:26px; font-weight:900; color:#111827; margin:4px 0; }
    .stat-sub { font-size:11px; color:#6b7280; }
    .section { margin-bottom:20px; }
    .section-title { font-size:13px; font-weight:700; color:#374151; margin-bottom:12px; }
    .health-row { display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #f3f4f6; font-size:12px; }
    .ai-box { background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:14px; margin-top:24px; font-size:12px; color:#92400e; line-height:1.6; }
    .footer { margin-top:32px; padding-top:12px; border-top:1px solid #e5e7eb; font-size:11px; color:#9ca3af; display:flex; justify-content:space-between; }
    @media print { body { padding:20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">ConstructIQ</div>
      <div class="subtitle">Automated Material Intelligence Platform</div>
    </div>
    <div style="text-align:right">
      <h1>${report.title} Report</h1>
      <div class="subtitle">${data.subtitle}</div>
    </div>
  </div>
  <div class="stats">
    ${data.stats.map(s => `<div class="stat-box"><div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div><div class="stat-sub">${s.sub}</div></div>`).join("")}
  </div>
  <div class="section">
    <div class="section-title">${data.healthTitle}</div>
    ${data.health.map(h => `<div class="health-row"><span>${h.label}</span><span style="font-weight:700;color:${h.color}">${h.pct}</span></div>`).join("")}
  </div>
  <div class="ai-box">
    <strong>⚡ AI Insight:</strong><br>${data.aiInsight}
  </div>
  <div class="footer">
    <span>Generated by ConstructIQ · ${new Date().toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" })}</span>
    <span>Confidential — For internal use only</span>
  </div>
</body>
</html>`;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}

// ── Generate Report modal ─────────────────────────────────────────────────────

function GenerateModal({ report, onClose }: { report: Report; onClose: () => void }) {
  const [from,      setFrom]      = useState("2026-05-01");
  const [to,        setTo]        = useState("2026-06-01");
  const [project,   setProject]   = useState("All Projects");
  const [format,    setFormat]    = useState(".CSV");
  const [requester, setRequester] = useState("Remy Santos");
  const [approver,  setApprover]  = useState("Ana Bonifacio");
  const [checks,    setChecks]    = useState({ cost:true, material:true, labor:false, audit:false });
  const [generated, setGenerated] = useState(false);

  const darkIn: React.CSSProperties = {
    background:"#1e2d50", color:"#fff", border:"1px solid rgba(255,255,255,0.1)",
    borderRadius:8, padding:"9px 12px", fontSize:"0.875rem", outline:"none",
    width:"100%", boxSizing:"border-box" as const,
  };

  function handleGenerate() {
    setGenerated(true);
    setTimeout(() => { generatePDF(report); onClose(); }, 600);
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#1a2235", borderRadius:16, padding:"1.75rem", width:500, maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ marginBottom:"1.25rem" }}>
          <p style={{ fontWeight:800, fontSize:"1.05rem", color:"#fff" }}>Generate Report</p>
          <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>{report.title}</p>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.875rem" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>From</p><input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={darkIn} suppressHydrationWarning /></div>
            <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>To</p><input type="date" value={to} onChange={e=>setTo(e.target.value)} style={darkIn} suppressHydrationWarning /></div>
          </div>
          <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>Projects</p>
            <select value={project} onChange={e=>setProject(e.target.value)} style={{ ...darkIn, appearance:"none" as any }}>
              {["All Projects","Metro Station Phase 3","BGC Tower Complex","Harbor Bridge Renovation","Southgate Mall Expansion","PUP ICTC Building"].map(p=><option key={p}>{p}</option>)}
            </select>
          </div>
          <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:"0.5rem" }}>Include in Report</p>
            {([["cost","Cost Breakdown"],["material","Material Usage"],["labor","Labor Analysis"],["audit","Audit Log"]] as [keyof typeof checks,string][]).map(([k,label])=>(
              <label key={k} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", marginBottom:8 }}>
                <input type="checkbox" checked={checks[k]} onChange={e=>setChecks(c=>({...c,[k]:e.target.checked}))} style={{ width:16, height:16, accentColor:"#22c55e" }} />
                <span style={{ fontSize:"0.8rem", color:"#d1d5db" }}>{label}</span>
              </label>
            ))}
          </div>
          <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>Format</p>
            <select value={format} onChange={e=>setFormat(e.target.value)} style={{ ...darkIn, appearance:"none" as any }}>
              {[".CSV",".PDF",".XLSX"].map(f=><option key={f}>{f}</option>)}
            </select>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>Requested by:</p>
              <select value={requester} onChange={e=>setRequester(e.target.value)} style={{ ...darkIn, appearance:"none" as any }}>
                {["Remy Santos","Ana Bonifacio","Jose Reyes"].map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>Approved by:</p>
              <select value={approver} onChange={e=>setApprover(e.target.value)} style={{ ...darkIn, appearance:"none" as any }}>
                {["Ana Bonifacio","Remy Santos","Jose Reyes"].map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end", marginTop:"1.5rem" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", background:"transparent", color:"#d1d5db", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleGenerate} style={{ padding:"9px 24px", borderRadius:8, border:"none", background: generated ? "#22c55e" : "#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer", transition:"background 0.2s" }}>
            {generated ? "✓ Generating..." : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View Report modal ─────────────────────────────────────────────────────────

function ViewModal({ report, onClose }: { report: Report; onClose: () => void }) {
  const data = VIEW_DATA[report.id];
  const Icon = report.icon;

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:"1rem" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:640, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.5rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, background:"#ffedd5", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <BarChart3 style={{ width:18, height:18, color:"#f97316" }} />
            </div>
            <div>
              <p style={{ fontWeight:800, fontSize:"1.05rem" }}>{report.title} Status Report</p>
              <p style={{ fontSize:"0.72rem", color:"#9ca3af" }}>{data.subtitle}</p>
            </div>
          </div>
          <div style={{ display:"flex", gap:"0.5rem", alignItems:"center" }}>
            <button onClick={()=>generatePDF(report)} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.8rem", fontWeight:700, cursor:"pointer" }}>
              <Download style={{ width:13, height:13 }} /> Export PDF
            </button>
            <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer", padding:4 }}><X style={{ width:20, height:20 }} /></button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"0.75rem", marginBottom:"1.25rem" }}>
          {data.stats.map(s => (
            <div key={s.label} style={{ border:"1px solid #e5e7eb", borderRadius:8, padding:"0.875rem" }}>
              <p style={{ fontSize:"0.62rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.06em" }}>{s.label}</p>
              <p style={{ fontSize:"1.8rem", fontWeight:800, color:"#111827", lineHeight:1.1, margin:"4px 0" }}>{s.value}</p>
              <p style={{ fontSize:"0.7rem", color:"#9ca3af" }}>{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Chart + Health */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 180px", gap:"1rem", marginBottom:"1.25rem" }}>
          <div>
            <p style={{ fontSize:"0.8rem", fontWeight:700, color:"#374151", marginBottom:"0.75rem" }}>{data.chartTitle}</p>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={data.chartData} margin={{ top:0, right:0, left:-30, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="name" tick={{ fontSize:10, fill:"#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize:10, fill:"#9ca3af" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius:8, border:"1px solid #e5e7eb", fontSize:"0.72rem" }} />
                <Bar dataKey="value" fill="#f97316" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <p style={{ fontSize:"0.8rem", fontWeight:700, color:"#374151", marginBottom:"0.75rem" }}>{data.healthTitle}</p>
            <div style={{ display:"flex", flexDirection:"column", gap:"0.5rem" }}>
              {data.health.map(h => (
                <div key={h.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:"0.75rem" }}>
                  <span style={{ color:"#6b7280" }}>{h.label}</span>
                  <span style={{ fontWeight:700, color:h.color }}>{h.pct}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI insight */}
        <div style={{ background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:8, padding:"0.875rem 1rem", marginBottom:"1.25rem", display:"flex", gap:8 }}>
          <Zap style={{ width:14, height:14, color:"#f97316", flexShrink:0, marginTop:2 }} />
          <p style={{ fontSize:"0.78rem", color:"#92400e", lineHeight:1.5 }}>{data.aiInsight}</p>
        </div>

        {/* Footer */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <p style={{ fontSize:"0.72rem", color:"#9ca3af" }}>Data refreshed: May 27, 2026</p>
          <button onClick={onClose} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.875rem", fontWeight:600, cursor:"pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type ModalState = { type:"view"|"generate"; report:Report } | null;

export default function ReportsPage() {
  const [modal,    setModal]    = useState<ModalState>(null);
  const [search,   setSearch]   = useState("");
  const [category, setCategory] = useState("All Categories");

  const filtered = useMemo(() => REPORTS.filter(r => {
    const matchSearch   = r.title.toLowerCase().includes(search.toLowerCase()) || r.desc.toLowerCase().includes(search.toLowerCase());
    const matchCategory = category === "All Categories" || r.category === category;
    return matchSearch && matchCategory;
  }), [search, category]);

  const btnOutline: React.CSSProperties = {
    display:"flex", alignItems:"center", gap:5,
    padding:"6px 12px", borderRadius:7, border:"1px solid #e5e7eb",
    background:"#fff", color:"#374151", fontSize:"0.75rem",
    fontWeight:500, cursor:"pointer",
  };
  const btnDark: React.CSSProperties = {
    display:"flex", alignItems:"center", gap:6,
    padding:"6px 14px", borderRadius:7, border:"none",
    background:"#111827", color:"#fff", fontSize:"0.75rem",
    fontWeight:600, cursor:"pointer",
  };

  return (
    <div style={{ background:"#f5f4f0" }}>
      {modal?.type === "view"     && <ViewModal     report={modal.report} onClose={()=>setModal(null)} />}
      {modal?.type === "generate" && <GenerateModal report={modal.report} onClose={()=>setModal(null)} />}

      <Header title="Reports" />

      <div style={{ padding:"1.25rem 1.5rem" }}>

        {/* Filter bar */}
        <div style={{ display:"flex", gap:"0.75rem", alignItems:"center", marginBottom:"1.25rem" }}>
          <div style={{ position:"relative", flex:1 }}>
            <Search style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", width:14, height:14, color:"#9ca3af", pointerEvents:"none" }} />
            <input
              suppressHydrationWarning
              value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search reports..."
              style={{ width:"100%", boxSizing:"border-box" as const, paddingLeft:34, paddingRight:12, paddingTop:9, paddingBottom:9, borderRadius:8, background:"#fff", border:"1px solid #e5e7eb", fontSize:"0.875rem", outline:"none" }}
            />
          </div>
          <select value={category} onChange={e=>setCategory(e.target.value)} style={{ padding:"8px 14px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", fontSize:"0.875rem", color:"#374151", outline:"none", cursor:"pointer", appearance:"none" as any }}>
            {["All Categories","Overview","Analytics","Operations","Management"].map(c=><option key={c}>{c}</option>)}
          </select>
          <button style={btnOutline}><Filter style={{ width:13, height:13 }} /> Filter by Date</button>
          <button style={{ ...btnOutline, background:"#f97316", border:"none", color:"#fff", fontWeight:700 }}>
            <Download style={{ width:13, height:13 }} /> Export All
          </button>
        </div>

        {/* Report cards grid */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem" }}>
          {filtered.map(report => {
            const Icon = report.icon;
            return (
              <div key={report.id} style={{ background:"#fff", borderRadius:14, padding:"1.25rem", boxShadow:"0 1px 3px rgba(0,0,0,0.07)" }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:"0.875rem" }}>
                  <div style={{ width:36, height:36, borderRadius:8, background:"#f9fafb", border:"1px solid #e5e7eb", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <Icon style={{ width:18, height:18, color:"#6b7280" }} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontWeight:700, fontSize:"0.95rem", color:"#111827" }}>{report.title}</p>
                    <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginTop:2 }}>{report.desc}</p>
                  </div>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div style={{ display:"flex", gap:"0.5rem" }}>
                    <button onClick={()=>setModal({ type:"view", report })} style={btnOutline}>
                      <Eye style={{ width:12, height:12 }} /> View
                    </button>
                    <button onClick={()=>generatePDF(report)} style={btnOutline}>
                      <Download style={{ width:12, height:12 }} /> PDF
                    </button>
                    <button onClick={()=>setModal({ type:"generate", report })} style={btnDark}>
                      <FileText style={{ width:12, height:12 }} /> Generate Report
                    </button>
                  </div>
                  <span style={{ fontSize:"0.72rem", color:"#9ca3af" }}>{report.date}</span>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
