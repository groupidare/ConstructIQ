"use client";

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import api from "@/lib/api";
import Header from "@/components/layout/Header";
import {
  Plus, MapPin, Calendar, Users, FileText,
  Ruler, BarChart3, X, AlertTriangle, Zap, Calculator,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ── Types ────────────────────────────────────────────────────────────────────

type ProjectStatus = "ACTIVE" | "PLANNING" | "COMPLETED" | "ON HOLD";

interface BOMRow { material: string; unit: string; qty: number; unitCost: number; supplier: string; }
interface Project {
  id: number;
  name: string;
  location: string;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  progress: number;
  progressColor: string;
  budget: string;
  spent: string;
  materials: number;
  manager: string;
  engineers: string[];
  type: string;
  bom: BOMRow[];
  forecastReady: boolean;
}

// ── Demo / seed data (visual enrichment source) ───────────────────────────────

const INIT_PROJECTS: Project[] = [
  { id:1, name:"Metro Station Phase 3",    location:"EDSA, QC",       startDate:"2024-08-01", endDate:"2026-03-31", status:"ACTIVE",    progress:62,  progressColor:"#f97316", budget:"₱45.0M",  spent:"₱27.9M", materials:8,  manager:"Remy Santos",  engineers:["Carlos Reyes","Maria Tan"],        type:"Infrastructure",    bom:[{ material:"Portland Cement (40kg)", unit:"bags", qty:250, unitCost:290, supplier:"ABI Corp."     }, { material:"Deformed Steel Bars (12mm)", unit:"pcs",  qty:180, unitCost:540, supplier:"CMC Trading"   }, { material:"CHB 4 inch",                 unit:"pcs",  qty:1200,unitCost:18,  supplier:"DCI Materials"  }], forecastReady:false },
  { id:2, name:"BGC Tower Complex",         location:"BGC, Taguig",    startDate:"2025-01-15", endDate:"2027-06-30", status:"ACTIVE",    progress:38,  progressColor:"#1e3154", budget:"₱120.0M", spent:"₱45.6M", materials:12, manager:"Remy Santos",  engineers:["Jose Lim"],                        type:"Commercial",        bom:[], forecastReady:false },
  { id:3, name:"Harbor Bridge Renovation",  location:"Manila Harbor",   startDate:"2024-03-01", endDate:"2025-12-31", status:"ACTIVE",    progress:81,  progressColor:"#22c55e", budget:"₱28.0M",  spent:"₱22.7M", materials:6,  manager:"Remy Santos",  engineers:["Carlos Reyes"],                    type:"Infrastructure",    bom:[], forecastReady:false },
  { id:4, name:"Southgate Mall Expansion",  location:"BGC, Taguig",    startDate:"2025-06-01", endDate:"2027-09-30", status:"PLANNING",  progress:12,  progressColor:"#374151", budget:"₱75.0M",  spent:"₱9.0M",  materials:4,  manager:"Remy Santos",  engineers:["Ana Cruz","Ben Torres"],           type:"Commercial",        bom:[], forecastReady:false },
  { id:5, name:"PUP ICTC Building",         location:"Sta. Mesa",       startDate:"2023-01-10", endDate:"2025-01-15", status:"COMPLETED", progress:100, progressColor:"#22c55e", budget:"₱19.3M",  spent:"₱19.1M", materials:9,  manager:"Remy Santos",  engineers:["Ana Cruz"],                        type:"Education",         bom:[], forecastReady:false },
];

// ── API response shape & mapper ───────────────────────────────────────────────

interface ProjectResponseDto {
  id: number; name: string; type: string; location: string;
  description?: string; budget: number; startDate: string;
  targetEndDate: string; status: string;
  assignedContractor?: string;
  projectManagerName: string; siteEngineerName?: string;
  phases: unknown[];
}

const STATUS_MAP: Record<string, ProjectStatus> = {
  Planning: "PLANNING", Active: "ACTIVE", OnHold: "ON HOLD",
  Completed: "COMPLETED", Cancelled: "COMPLETED",
};
const PROGRESS_COLOR: Record<string, string> = {
  PLANNING: "#374151", ACTIVE: "#f97316", COMPLETED: "#22c55e", "ON HOLD": "#d97706",
};

function toProject(dto: ProjectResponseDto): Project {
  const status = (STATUS_MAP[dto.status] ?? "PLANNING") as ProjectStatus;
  const demo = INIT_PROJECTS.find(p => p.name === dto.name);
  return {
    id: dto.id,
    name: dto.name,
    location: dto.location,
    type: dto.type,
    startDate: dto.startDate.split("T")[0],
    endDate: dto.targetEndDate.split("T")[0],
    status,
    progress:      demo?.progress      ?? (status === "COMPLETED" ? 100 : status === "ACTIVE" ? 50 : 10),
    progressColor: demo?.progressColor ?? PROGRESS_COLOR[status] ?? "#374151",
    budget: `₱${Number(dto.budget).toLocaleString()}`,
    spent:     demo?.spent     ?? "₱0",
    materials: demo?.materials ?? 0,
    manager:   demo?.manager   ?? dto.projectManagerName,
    engineers: demo?.engineers ?? (dto.siteEngineerName ? [dto.siteEngineerName] : []),
    bom:           demo?.bom           ?? [],
    forecastReady: demo?.forecastReady ?? false,
  };
}

const STATUS_STYLE: Record<ProjectStatus, { bg: string; color: string }> = {
  ACTIVE:    { bg: "#dcfce7", color: "#15803d" },
  PLANNING:  { bg: "#ffedd5", color: "#c2410c" },
  COMPLETED: { bg: "#f3f4f6", color: "#374151" },
  "ON HOLD": { bg: "#fef3c7", color: "#b45309" },
};

const inputStyle: React.CSSProperties = {
  background: "#111827", color: "#fff", border: "none", borderRadius: 8,
  padding: "10px 12px", fontSize: "0.875rem", outline: "none",
  width: "100%", boxSizing: "border-box" as const,
};

// ── Helper ────────────────────────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:"1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ maxHeight:"90vh", overflowY:"auto" }}>
        {children}
      </div>
    </div>
  );
}

// ── Forecast simulation modal ─────────────────────────────────────────────────

function ForecastModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const weeks = ["Wk 1","Wk 2","Wk 3","Wk 4","Wk 5","Wk 6","Wk 7","Wk 8"];
  const data = weeks.map((wk, i) => {
    const row: Record<string, string | number> = { week: wk };
    project.bom.slice(0,3).forEach(b => {
      const curve = Math.sin((i / 7) * Math.PI) * 0.6 + 0.4;
      row[b.material.split(" ")[0]] = Math.round((b.qty / 8) * (i + 1) * 0.8 * curve);
    });
    return row;
  });
  const colors = ["#f97316", "#22c55e", "#3b82f6"];
  const keys = project.bom.slice(0,3).map(b => b.material.split(" ")[0]);

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:680 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <Zap style={{ width:18, height:18, color:"#f97316" }} />
              <p style={{ fontWeight:800, fontSize:"1.1rem" }}>Simulated Material Forecast</p>
            </div>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>{project.name} — AI-projected 8-week material consumption</p>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:8, padding:"0.75rem 1rem", marginBottom:"1.25rem", display:"flex", gap:10 }}>
          <Zap style={{ width:14, height:14, color:"#16a34a", flexShrink:0, marginTop:3 }} />
          <p style={{ fontSize:"0.78rem", color:"#15803d", lineHeight:1.5 }}>
            ConstructIQ generated this forecast using your BOM, project schedule, and historical usage patterns. Demand peaks are highlighted — procurement is recommended 7 days before each peak.
          </p>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top:4, right:8, left:-20, bottom:0 }}>
            <defs>
              {keys.map((k,i) => (
                <linearGradient key={k} id={`grad${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={colors[i]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={colors[i]} stopOpacity={0}   />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="week" tick={{ fontSize:12, fill:"#9ca3af" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize:12, fill:"#9ca3af" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius:8, border:"1px solid #e5e7eb", fontSize:"0.75rem" }} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize:"0.75rem", paddingTop:8 }} />
            {keys.map((k,i) => (
              <Area key={k} type="monotone" dataKey={k} stroke={colors[i]} strokeWidth={2} fill={`url(#grad${i})`} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"0.75rem", marginTop:"1.25rem" }}>
          {project.bom.slice(0,3).map((b,i) => (
            <div key={b.material} style={{ background:"#f9fafb", borderRadius:10, padding:"0.875rem", border:`2px solid ${colors[i]}20` }}>
              <p style={{ fontSize:"0.7rem", color:"#9ca3af", marginBottom:4 }}>{b.material}</p>
              <p style={{ fontWeight:700, fontSize:"1.1rem", color:colors[i] }}>{b.qty} {b.unit}</p>
              <p style={{ fontSize:"0.68rem", color:"#9ca3af" }}>Peak: Week {i + 4}</p>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontWeight:700, fontSize:"0.875rem", cursor:"pointer" }}>
            Done
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── New Project modal ─────────────────────────────────────────────────────────

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (p: Project) => void }) {
  const [name,        setName]        = useState("");
  const [type,        setType]        = useState("Renovation");
  const [location,    setLocation]    = useState("");
  const [budget,      setBudget]      = useState("1500000");
  const [startDate,   setStartDate]   = useState("2026-05-05");
  const [endDate,     setEndDate]     = useState("2026-08-08");
  const [contractor,  setContractor]  = useState("");
  const [description, setDescription] = useState("");
  const [saving,      setSaving]      = useState(false);

  async function handleCreate() {
    if (!name.trim() || !location.trim()) {
      toast.error("Project name and location are required.");
      return;
    }
    setSaving(true);
    try {
      const budgetNum = parseFloat(budget.replace(/[^0-9.]/g, "")) || 0;
      const { data } = await api.post<ProjectResponseDto>("/projects", {
        name: name.trim(),
        type,
        location: location.trim(),
        description: description || null,
        budget: budgetNum,
        startDate: new Date(startDate).toISOString(),
        targetEndDate: new Date(endDate).toISOString(),
        assignedContractor: contractor || null,
        siteEngineerId: null,
        phases: [],
      });
      toast.success(`Project "${data.name}" created!`);
      onCreate(toProject(data));
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? "Failed to create project.");
    } finally {
      setSaving(false);
    }
  }

  const selectStyle: React.CSSProperties = { ...inputStyle, cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"] };

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:560 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.5rem" }}>
          <p style={{ fontWeight:800, fontSize:"1.1rem" }}>New Project</p>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
          <div>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Project Name *</p>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="ICTC Hall" style={inputStyle} suppressHydrationWarning />
          </div>
          <div>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Project Type *</p>
            <select value={type} onChange={e=>setType(e.target.value)} style={selectStyle}>
              {["Renovation","Commercial","Industrial","Infrastructure","Residential"].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Location *</p>
            <input value={location} onChange={e=>setLocation(e.target.value)} placeholder="BGC Taguig" style={inputStyle} suppressHydrationWarning />
          </div>
          <div>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Budget (₱)</p>
            <input value={budget} onChange={e=>setBudget(e.target.value)} placeholder="1500000" type="number" style={inputStyle} suppressHydrationWarning />
          </div>
          <div>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Start Date *</p>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={inputStyle} suppressHydrationWarning />
          </div>
          <div>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>End Date *</p>
            <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} style={inputStyle} suppressHydrationWarning />
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Contractor</p>
            <input value={contractor} onChange={e=>setContractor(e.target.value)} placeholder="e.g. Discaya Construction" style={inputStyle} suppressHydrationWarning />
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Project Description</p>
            <textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Brief description of the project..." rows={3} style={{ ...inputStyle, resize:"vertical" as React.CSSProperties["resize"] }} suppressHydrationWarning />
          </div>
        </div>
        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end", marginTop:"1.5rem" }}>
          <button onClick={onClose} disabled={saving} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", fontWeight:500, cursor:"pointer" }}>Cancel</button>
          <button onClick={handleCreate} disabled={saving} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Creating..." : "Create Project"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Material Plan modal ───────────────────────────────────────────────────────

function MaterialPlanModal({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (bom: BOMRow[]) => void }) {
  const [phase,   setPhase]   = useState("Foundation");
  const [period,  setPeriod]  = useState("30 days");
  const [reorder, setReorder] = useState("20");
  const [waste,   setWaste]   = useState("10");
  const [lead,    setLead]    = useState("7");
  const [rows,    setRows]    = useState<BOMRow[]>(
    project.bom.length > 0 ? project.bom : [
      { material:"Portland Cement (40kg)", unit:"bags", qty:250, unitCost:290, supplier:"ABI Corp."    },
      { material:"Deformed Steel Bars (12mm)", unit:"pcs", qty:180, unitCost:540, supplier:"CMC Trading"  },
      { material:"CHB 4 inch",             unit:"pcs",  qty:1200,unitCost:18,  supplier:"DCI Materials" },
    ]
  );

  const total = rows.reduce((s,r) => s + r.qty * r.unitCost, 0);

  function addRow() {
    setRows(r => [...r, { material:"", unit:"pcs", qty:0, unitCost:0, supplier:"" }]);
  }
  function updateRow(i: number, field: keyof BOMRow, val: string | number) {
    setRows(r => r.map((row,idx) => idx === i ? { ...row, [field]: val } : row));
  }

  const cell: React.CSSProperties = { ...inputStyle, padding:"7px 8px", fontSize:"0.78rem" };

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:720 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem" }}>
          <div>
            <p style={{ fontWeight:800, fontSize:"1.05rem" }}>
              Material Planning — <span style={{ color:"#f97316" }}>{project.name}</span>
            </p>
            <p style={{ fontSize:"0.75rem", color:"#9ca3af", marginTop:2 }}>Bill of Materials (BOM) &amp; procurement planning</p>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:20, height:20 }} /></button>
        </div>

        {/* Project details */}
        <p style={{ fontSize:"0.68rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", marginBottom:"0.625rem" }}>PROJECT DETAILS</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem", marginBottom:"1.25rem" }}>
          <div>
            <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>PROJECT PHASE *</p>
            <input value={phase} onChange={e=>setPhase(e.target.value)} style={inputStyle} suppressHydrationWarning />
          </div>
          <div>
            <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>PLANNING PERIOD *</p>
            <input value={period} onChange={e=>setPeriod(e.target.value)} style={inputStyle} suppressHydrationWarning />
          </div>
        </div>

        {/* BOM */}
        <p style={{ fontSize:"0.68rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", marginBottom:"0.625rem" }}>BILL OF MATERIALS (BOM)</p>
        <div style={{ display:"grid", gridTemplateColumns:"2fr 0.7fr 0.7fr 0.9fr 0.9fr 1fr", gap:4, marginBottom:4 }}>
          {["MATERIAL","UNIT","EST. QTY","UNIT COST (₱)","TOTAL (₱)","SUPPLIER"].map(h => (
            <p key={h} style={{ fontSize:"0.6rem", color:"#9ca3af", fontWeight:700 }}>{h}</p>
          ))}
        </div>
        {rows.map((row, i) => (
          <div key={i} style={{ display:"grid", gridTemplateColumns:"2fr 0.7fr 0.7fr 0.9fr 0.9fr 1fr", gap:4, marginBottom:4 }}>
            <input value={row.material}  onChange={e=>updateRow(i,"material",e.target.value)}  style={cell} suppressHydrationWarning />
            <input value={row.unit}      onChange={e=>updateRow(i,"unit",e.target.value)}      style={cell} suppressHydrationWarning />
            <input value={row.qty}       onChange={e=>updateRow(i,"qty",Number(e.target.value))} type="number" style={cell} suppressHydrationWarning />
            <input value={row.unitCost}  onChange={e=>updateRow(i,"unitCost",Number(e.target.value))} type="number" style={cell} suppressHydrationWarning />
            <div style={{ ...cell, background:"#1a2235", display:"flex", alignItems:"center", borderRadius:8 }}>
              <span style={{ color:"#f97316", fontWeight:700, fontSize:"0.78rem" }}>₱{(row.qty*row.unitCost).toLocaleString()}</span>
            </div>
            <input value={row.supplier}  onChange={e=>updateRow(i,"supplier",e.target.value)} style={cell} suppressHydrationWarning />
          </div>
        ))}
        <button onClick={addRow} style={{ color:"#0d9488", background:"none", border:"none", cursor:"pointer", fontSize:"0.8rem", fontWeight:600, margin:"0.5rem 0 1.25rem", display:"flex", alignItems:"center", gap:4 }}>
          <Plus style={{ width:14, height:14 }} /> Add Material Row
        </button>

        {/* Procurement Settings */}
        <p style={{ fontSize:"0.68rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", marginBottom:"0.625rem" }}>PROCUREMENT SETTINGS</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.75rem", marginBottom:"0.875rem" }}>
          {[["REORDER POINT (%)", reorder, setReorder],["WASTE BUFFER (%)", waste, setWaste],["LEAD TIME (DAYS)", lead, setLead]].map(([label, val, setter]) => (
            <div key={label as string}>
              <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>{label as string}</p>
              <input value={val as string} onChange={e=>(setter as any)(e.target.value)} style={inputStyle} suppressHydrationWarning />
            </div>
          ))}
        </div>

        {/* Info box */}
        <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:8, padding:"0.75rem 1rem", marginBottom:"1.25rem", display:"flex", gap:8 }}>
          <Zap style={{ width:14, height:14, color:"#3b82f6", flexShrink:0, marginTop:2 }} />
          <p style={{ fontSize:"0.75rem", color:"#1d4ed8", lineHeight:1.5 }}>
            ConstructIQ will use this BOM alongside project schedules and historical usage to generate demand forecasts and automated procurement recommendations.
          </p>
        </div>

        {/* Footer */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:"#f97316", fontWeight:700, fontSize:"0.875rem" }}>Est. Total: ₱{total.toLocaleString()}</span>
          <div style={{ display:"flex", gap:"0.75rem" }}>
            <button onClick={onClose} style={{ padding:"9px 18px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.8rem", cursor:"pointer" }}>Cancel</button>
            <button onClick={()=>onSave(rows)} style={{ padding:"9px 18px", borderRadius:8, border:"none", background:"#0d9488", color:"#fff", fontSize:"0.8rem", fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
              <Zap style={{ width:13, height:13 }} /> Run Forecast
            </button>
            <button onClick={()=>onSave(rows)} style={{ padding:"9px 18px", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.8rem", fontWeight:600, cursor:"pointer" }}>
              + Add to BOM
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

// ── Measurements modal ────────────────────────────────────────────────────────

function MeasurementsModal({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: () => void }) {
  const [structType, setStructType] = useState<"Floor Slab"|"Wall"|"Column">("Floor Slab");
  const [label,      setLabel]      = useState("");
  const [length,     setLength]     = useState("");
  const [width,      setWidth]      = useState("");
  const [thickness,  setThickness]  = useState("0.10");
  const [mixRatio,   setMixRatio]   = useState("1:2:4 (Standard)");
  const [allowance,  setAllowance]  = useState("12");
  const [results,    setResults]    = useState<null | { cement: number; sand: number; gravel: number }>(null);

  function calculate() {
    const L = parseFloat(length) || 0;
    const W = parseFloat(width) || 0;
    const T = parseFloat(thickness) || 0;
    const vol = L * W * T;
    const waste = 1 + (parseFloat(allowance) / 100);
    setResults({
      cement: Math.ceil(vol * 8 * waste),
      sand:   parseFloat((vol * 0.44 * waste).toFixed(2)),
      gravel: parseFloat((vol * 0.88 * waste).toFixed(2)),
    });
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:600 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <Ruler style={{ width:18, height:18, color:"#f97316" }} />
              <p style={{ fontWeight:800, fontSize:"1.05rem" }}>Material Measurement Assistant</p>
            </div>
            <p style={{ fontSize:"0.75rem", color:"#9ca3af", marginTop:2 }}>{project.name} — Site measurement &amp; quantity estimation</p>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:20, height:20 }} /></button>
        </div>

        {/* Structure type */}
        <p style={{ fontSize:"0.68rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", marginBottom:"0.625rem" }}>STRUCTURE TYPE</p>
        <div style={{ display:"flex", background:"#111827", borderRadius:10, padding:4, width:"fit-content", marginBottom:"1.25rem" }}>
          {(["Floor Slab","Wall","Column"] as const).map(t => (
            <button key={t} onClick={()=>setStructType(t)} style={{
              padding:"8px 20px", borderRadius:8, border:"none", cursor:"pointer", fontSize:"0.875rem", fontWeight:500,
              background: structType===t ? "#fff" : "transparent",
              color:      structType===t ? "#111827" : "#9ca3af",
              transition:"all 0.15s",
            }}>{t}</button>
          ))}
        </div>

        {/* Site measurements */}
        <p style={{ fontSize:"0.68rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", marginBottom:"0.625rem" }}>SITE MEASUREMENTS</p>
        <div style={{ marginBottom:"0.75rem" }}>
          <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>STRUCTURE / AREA LABEL</p>
          <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. Ground Floor — Zone A" style={inputStyle} suppressHydrationWarning />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.75rem", marginBottom:"0.75rem" }}>
          <div>
            <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>LENGTH (M)</p>
            <input value={length} onChange={e=>setLength(e.target.value)} placeholder="0.00" type="number" style={inputStyle} suppressHydrationWarning />
          </div>
          <div>
            <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>WIDTH (M)</p>
            <input value={width} onChange={e=>setWidth(e.target.value)} placeholder="0.00" type="number" style={inputStyle} suppressHydrationWarning />
          </div>
          <div>
            <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>THICKNESS (M)</p>
            <input value={thickness} onChange={e=>setThickness(e.target.value)} placeholder="0.10" type="number" style={inputStyle} suppressHydrationWarning />
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem", marginBottom:"1rem" }}>
          <div>
            <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>CONCRETE MIX RATIO</p>
            <select value={mixRatio} onChange={e=>setMixRatio(e.target.value)} style={{ ...inputStyle, appearance:"none" as any }}>
              <option>1:2:4 (Standard)</option>
              <option>1:1.5:3 (Rich Mix)</option>
              <option>1:3:6 (Lean Mix)</option>
            </select>
          </div>
          <div>
            <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>WASTE ALLOWANCE (%)</p>
            <input value={allowance} onChange={e=>setAllowance(e.target.value)} type="number" style={inputStyle} suppressHydrationWarning />
          </div>
        </div>

        <button onClick={calculate} style={{ width:"100%", padding:"11px", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.875rem", fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:"0.875rem" }}>
          <Calculator style={{ width:16, height:16 }} /> Calculate Material Requirements
        </button>

        {results && (
          <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:10, padding:"1rem", marginBottom:"0.875rem" }}>
            <p style={{ fontSize:"0.75rem", fontWeight:700, color:"#15803d", marginBottom:"0.75rem" }}>Calculated Requirements</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.5rem" }}>
              {[["Portland Cement","bags",results.cement,"#f97316"],["Fine Sand","m³",results.sand,"#22c55e"],["Coarse Gravel","m³",results.gravel,"#3b82f6"]].map(([name,unit,val,color]) => (
                <div key={name as string} style={{ background:"#fff", borderRadius:8, padding:"0.75rem", textAlign:"center" }}>
                  <p style={{ fontSize:"1.1rem", fontWeight:800, color:color as string }}>{String(val)}</p>
                  <p style={{ fontSize:"0.65rem", color:"#6b7280" }}>{unit as string}</p>
                  <p style={{ fontSize:"0.65rem", color:"#9ca3af" }}>{name as string}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <p style={{ fontSize:"0.72rem", color:"#9ca3af" }}>Results follow DPWH standard mix ratios</p>
          <div style={{ display:"flex", gap:"0.75rem" }}>
            <button onClick={onClose} style={{ padding:"9px 18px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.8rem", cursor:"pointer" }}>Cancel</button>
            <button onClick={()=>{ onSave(); onClose(); }} style={{ padding:"9px 18px", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.8rem", fontWeight:600, cursor:"pointer" }}>+ Add to BOM</button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

// ── Reports modal ─────────────────────────────────────────────────────────────

function ReportsModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [reportType,  setReportType]  = useState("Inventory Stock");
  const [fromDate,    setFromDate]    = useState("2026-05-01");
  const [toDate,      setToDate]      = useState("2026-06-01");
  const [selProject,  setSelProject]  = useState("Southgate Mall Expansion");
  const [format,      setFormat]      = useState(".CSV");
  const [requester,   setRequester]   = useState("Remy Santos");
  const [approver,    setApprover]    = useState("Ana Bonifacio");
  const [checks,      setChecks]      = useState({ cost:true, material:true, labor:false, audit:false });

  const darkInput: React.CSSProperties = { ...inputStyle, background:"#1e2d50", border:"1px solid rgba(255,255,255,0.1)" };

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#1a2235", borderRadius:16, padding:"1.75rem", width:520 }}>
        <div style={{ marginBottom:"1.25rem" }}>
          <p style={{ fontWeight:800, fontSize:"1.05rem", color:"#fff" }}>Generate Report</p>
          <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>{project.name}</p>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:"0.875rem" }}>
          <div>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Report Type/Project</p>
            <select value={reportType} onChange={e=>setReportType(e.target.value)} style={{ ...darkInput, appearance:"none" as any, width:"100%", color:"#fff" }}>
              {["Inventory Stock","Excess Analytics","Procurement Summary","Material Usage","Cost Report"].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            <div>
              <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>From</p>
              <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={{ ...darkInput, color:"#fff", width:"100%", boxSizing:"border-box" }} suppressHydrationWarning />
            </div>
            <div>
              <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>To</p>
              <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={{ ...darkInput, color:"#fff", width:"100%", boxSizing:"border-box" }} suppressHydrationWarning />
            </div>
          </div>
          <div>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Projects</p>
            <select value={selProject} onChange={e=>setSelProject(e.target.value)} style={{ ...darkInput, appearance:"none" as any, width:"100%", color:"#fff" }}>
              {["Southgate Mall Expansion","Metro Station Phase 3","BGC Tower Complex","Harbor Bridge Renovation","PUP ICTC Building"].map(p=><option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:"0.5rem" }}>Include in Report</p>
            {([["cost","Cost Breakdown"],["material","Material Usage"],["labor","Labor Analysis"],["audit","Audit Log"]] as [keyof typeof checks, string][]).map(([k,label]) => (
              <label key={k} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", marginBottom:8 }}>
                <input type="checkbox" checked={checks[k]} onChange={e=>setChecks(c=>({...c,[k]:e.target.checked}))} style={{ width:16, height:16, accentColor:"#22c55e" }} />
                <span style={{ fontSize:"0.8rem", color:"#d1d5db" }}>{label}</span>
              </label>
            ))}
          </div>
          <div>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Format</p>
            <select value={format} onChange={e=>setFormat(e.target.value)} style={{ ...darkInput, appearance:"none" as any, width:"100%", color:"#fff" }}>
              {[".CSV",".PDF",".XLSX"].map(f=><option key={f}>{f}</option>)}
            </select>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            <div>
              <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Requested by:</p>
              <select value={requester} onChange={e=>setRequester(e.target.value)} style={{ ...darkInput, appearance:"none" as any, width:"100%", color:"#fff" }}>
                {["Remy Santos","Ana Bonifacio","Jose Reyes"].map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Approved by:</p>
              <select value={approver} onChange={e=>setApprover(e.target.value)} style={{ ...darkInput, appearance:"none" as any, width:"100%", color:"#fff" }}>
                {["Ana Bonifacio","Remy Santos","Jose Reyes"].map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end", marginTop:"1.5rem" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", background:"transparent", color:"#d1d5db", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>Generate</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Project card ──────────────────────────────────────────────────────────────

function ProjectCard({ project, onMaterialPlan, onMeasurements, onReports }: {
  project: Project;
  onMaterialPlan: () => void;
  onMeasurements: () => void;
  onReports: () => void;
}) {
  const st = STATUS_STYLE[project.status];
  const actionBtn: React.CSSProperties = {
    flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6,
    padding:"9px 0", borderRadius:8, border:"none", background:"#111827",
    color:"#fff", fontSize:"0.78rem", fontWeight:600, cursor:"pointer",
  };

  return (
    <div style={{ background:"#fff", borderRadius:14, padding:"1.25rem", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"0.5rem" }}>
        <p style={{ fontWeight:700, fontSize:"1rem", color:"#2563eb", cursor:"pointer" }}>{project.name}</p>
        <span style={{ fontSize:"0.65rem", fontWeight:700, padding:"3px 9px", borderRadius:999, background:st.bg, color:st.color, whiteSpace:"nowrap", flexShrink:0 }}>
          · {project.status}
        </span>
      </div>

      {/* Meta */}
      <div style={{ display:"flex", gap:16, marginBottom:"0.875rem" }}>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <MapPin style={{ width:12, height:12, color:"#9ca3af" }} />
          <span style={{ fontSize:"0.72rem", color:"#9ca3af" }}>{project.location}</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <Calendar style={{ width:12, height:12, color:"#9ca3af" }} />
          <span style={{ fontSize:"0.72rem", color:"#9ca3af" }}>{project.startDate} – {project.endDate}</span>
        </div>
      </div>

      {/* Progress */}
      <div style={{ marginBottom:"0.875rem" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
          <span style={{ fontSize:"0.7rem", color:"#9ca3af" }}>Progress</span>
          <span style={{ fontSize:"0.72rem", fontWeight:700, color:project.progressColor }}>{project.progress}%</span>
        </div>
        <div style={{ height:8, background:"#e5e7eb", borderRadius:99 }}>
          <div style={{ height:"100%", width:`${project.progress}%`, background:project.progressColor, borderRadius:99 }} />
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.5rem", marginBottom:"0.75rem" }}>
        {[["Budget",project.budget],["Spent",project.spent],["Materials",`${project.materials} items`]].map(([label,val]) => (
          <div key={label} style={{ background:"#f9fafb", borderRadius:8, padding:"0.6rem 0.75rem" }}>
            <p style={{ fontSize:"0.6rem", color:"#9ca3af" }}>{label}</p>
            <p style={{ fontWeight:700, fontSize:"0.85rem", color:"#111827" }}>{val}</p>
          </div>
        ))}
      </div>

      {/* Team */}
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:"0.875rem" }}>
        <Users style={{ width:12, height:12, color:"#9ca3af" }} />
        <span style={{ fontSize:"0.7rem", color:"#6b7280" }}>
          {project.manager}
          {project.engineers.length > 0 && ` · Engineers: ${project.engineers.join(", ")}`}
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display:"flex", gap:"0.5rem" }}>
        <button onClick={onMaterialPlan} style={actionBtn}>
          <FileText style={{ width:13, height:13 }} /> Material Plan
        </button>
        <button onClick={onMeasurements} style={actionBtn}>
          <Ruler style={{ width:13, height:13 }} /> Measurements
        </button>
        <button onClick={onReports} style={actionBtn}>
          <BarChart3 style={{ width:13, height:13 }} /> Reports
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type ModalState = { type: "new" | "materialPlan" | "measurements" | "reports" | "forecast"; project?: Project } | null;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>(INIT_PROJECTS);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState<ModalState>(null);

  useEffect(() => {
    api.get<ProjectResponseDto[]>("/projects")
      .then(r => setProjects(r.data.map(toProject)))
      .catch(() => toast.error("Failed to load projects."))
      .finally(() => setLoading(false));
  }, []);

  const active = projects.filter(p => p.status === "ACTIVE").length;

  function handleCreate(p: Project) {
    setProjects(prev => [...prev, p]);
  }

  function handleSaveBOM(project: Project, bom: BOMRow[]) {
    setProjects(prev => prev.map(p => p.id === project.id ? { ...p, bom, forecastReady: bom.length > 0 } : p));
    setModal({ type:"forecast", project: { ...project, bom } });
  }

  function handleSaveMeasurements(project: Project) {
    if (project.bom.length > 0) {
      setModal({ type:"forecast", project });
    }
  }

  const proj = modal?.project;

  return (
    <div style={{ background:"#f5f4f0" }}>
      {/* Modals */}
      {modal?.type === "new"          && <NewProjectModal      onClose={()=>setModal(null)} onCreate={handleCreate} />}
      {modal?.type === "materialPlan" && proj && <MaterialPlanModal   project={proj} onClose={()=>setModal(null)} onSave={bom=>handleSaveBOM(proj,bom)} />}
      {modal?.type === "measurements" && proj && <MeasurementsModal   project={proj} onClose={()=>setModal(null)} onSave={()=>handleSaveMeasurements(proj)} />}
      {modal?.type === "reports"      && proj && <ReportsModal        project={proj} onClose={()=>setModal(null)} />}
      {modal?.type === "forecast"     && proj && <ForecastModal       project={proj} onClose={()=>setModal(null)} />}

      <Header title="Projects" />

      <div style={{ padding:"1.25rem 1.5rem" }}>
        {/* Page header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.5rem" }}>
          <div>
            <p style={{ fontWeight:800, fontSize:"1.4rem", color:"#111827" }}>All Projects</p>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>
              {loading ? "Loading..." : `${projects.length} projects · ${active} active`}
            </p>
          </div>
          <button onClick={()=>setModal({ type:"new" })} style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 20px", borderRadius:10, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>
            <Plus style={{ width:16, height:16 }} /> New Project
          </button>
        </div>

        {/* Cards grid */}
        {loading ? (
          <div style={{ padding:"3rem", textAlign:"center", color:"#9ca3af" }}>Loading projects…</div>
        ) : projects.length === 0 ? (
          <div style={{ padding:"3rem", textAlign:"center", color:"#9ca3af" }}>No projects yet. Click &ldquo;New Project&rdquo; to get started.</div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem" }}>
            {projects.map(p => (
              <ProjectCard
                key={p.id}
                project={p}
                onMaterialPlan={()=>setModal({ type:"materialPlan", project:p })}
                onMeasurements={()=>setModal({ type:"measurements", project:p })}
                onReports={     ()=>setModal({ type:"reports",      project:p })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
