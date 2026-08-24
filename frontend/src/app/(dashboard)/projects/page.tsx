"use client";

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import api from "@/lib/api";
import Header from "@/components/layout/Header";
import {
  Plus, MapPin, Calendar, Users, FileText, Ruler, BarChart3, X,
  Zap, Calculator, Archive, ChevronDown, ChevronUp, Brain, Target,
  TrendingUp, CheckCircle2, BarChart2, Pencil, Package,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

type ProjectStatus = "ACTIVE" | "PLANNING" | "COMPLETED" | "ON HOLD";
interface BOMRow { material: string; unit: string; qty: number; unitCost: number; supplier: string; }
interface Project {
  id: number; name: string; location: string;
  startDate: string; endDate: string; status: ProjectStatus;
  progress: number; progressColor: string;
  budget: string; spent: string; materials: number;
  manager: string; engineers: string[];
  type: string; bom: BOMRow[]; forecastReady: boolean;
}
interface PhaseMat { material: string; unit: string; actualQty: number; forecastQty: number; unitCost: number; }
interface FPhase { name: string; duration: string; materials: PhaseMat[]; }
interface FinishedProject {
  id: number; name: string; location: string; type: string;
  startDate: string; endDate: string;
  budget: number; spent: number;
  manager: string; notes: string;
  phases: FPhase[];
}

// ── Active / planning projects ────────────────────────────────────────────────

const INIT_PROJECTS: Project[] = [
  { id:1, name:"Metro Station Phase 3",   location:"EDSA, QC",      startDate:"2024-08-01", endDate:"2026-03-31", status:"ACTIVE",   progress:62,  progressColor:"#f97316", budget:"₱45.0M",  spent:"₱27.9M", materials:8,  manager:"Remy Santos",  engineers:["Carlos Reyes","Maria Tan"],  type:"Infrastructure", bom:[{ material:"Portland Cement (40kg)", unit:"bags", qty:250, unitCost:290, supplier:"ABI Corp." },{ material:"Deformed Steel Bars (12mm)", unit:"pcs", qty:180, unitCost:540, supplier:"CMC Trading" },{ material:"CHB 4 inch", unit:"pcs", qty:1200, unitCost:18, supplier:"DCI Materials" }], forecastReady:false },
  { id:2, name:"BGC Tower Complex",        location:"BGC, Taguig",   startDate:"2025-01-15", endDate:"2027-06-30", status:"ACTIVE",   progress:38,  progressColor:"#1e3154", budget:"₱120.0M", spent:"₱45.6M", materials:12, manager:"Remy Santos",  engineers:["Jose Lim"],                  type:"Commercial",     bom:[], forecastReady:false },
  { id:3, name:"Harbor Bridge Renovation", location:"Manila Harbor",  startDate:"2024-03-01", endDate:"2025-12-31", status:"ACTIVE",   progress:81,  progressColor:"#22c55e", budget:"₱28.0M",  spent:"₱22.7M", materials:6,  manager:"Remy Santos",  engineers:["Carlos Reyes"],              type:"Infrastructure", bom:[], forecastReady:false },
  { id:4, name:"Southgate Mall Expansion", location:"BGC, Taguig",   startDate:"2025-06-01", endDate:"2027-09-30", status:"PLANNING", progress:12,  progressColor:"#374151", budget:"₱75.0M",  spent:"₱9.0M",  materials:4,  manager:"Remy Santos",  engineers:["Ana Cruz","Ben Torres"],     type:"Commercial",     bom:[], forecastReady:false },
  { id:5, name:"PUP ICTC Building",        location:"Sta. Mesa",      startDate:"2023-01-10", endDate:"2025-01-15", status:"COMPLETED",progress:100, progressColor:"#22c55e", budget:"₱19.3M",  spent:"₱19.1M", materials:9,  manager:"Remy Santos",  engineers:["Ana Cruz"],                  type:"Infrastructure", bom:[], forecastReady:false },
];

// ── Finished Projects Repository ──────────────────────────────────────────────

const INIT_FINISHED: FinishedProject[] = [
  {
    id:101, name:"PUP ICTC Building", location:"Sta. Mesa, Manila", type:"Infrastructure",
    startDate:"2023-01-10", endDate:"2025-01-15", budget:19300000, spent:19100000,
    manager:"Remy Santos", notes:"4-storey RC ICT center. State university campus build-out.",
    phases:[
      { name:"Foundation", duration:"3 months", materials:[
        { material:"Portland Cement (40kg)", unit:"bags", actualQty:1820, forecastQty:1750, unitCost:290 },
        { material:"Deformed Bars 16mm", unit:"pcs", actualQty:680, forecastQty:700, unitCost:580 },
        { material:"Coarse Aggregates", unit:"m³", actualQty:95, forecastQty:90, unitCost:1200 },
        { material:"Fine Aggregates", unit:"m³", actualQty:48, forecastQty:45, unitCost:900 },
      ]},
      { name:"Structural", duration:"8 months", materials:[
        { material:"Portland Cement (40kg)", unit:"bags", actualQty:3200, forecastQty:3000, unitCost:290 },
        { material:"Deformed Bars 12mm", unit:"pcs", actualQty:1240, forecastQty:1200, unitCost:480 },
        { material:"CHB 4-inch", unit:"pcs", actualQty:18500, forecastQty:18000, unitCost:14 },
        { material:"Ready-mix Concrete", unit:"m³", actualQty:320, forecastQty:300, unitCost:5800 },
      ]},
      { name:"MEP", duration:"4 months", materials:[
        { material:"PVC Pipes 4-inch", unit:"length", actualQty:240, forecastQty:220, unitCost:450 },
        { material:"Electrical Conduit", unit:"length", actualQty:380, forecastQty:360, unitCost:180 },
        { material:"Circuit Breaker 20A", unit:"pcs", actualQty:48, forecastQty:44, unitCost:850 },
      ]},
      { name:"Finishing", duration:"3 months", materials:[
        { material:"Floor Tiles 60x60", unit:"sqm", actualQty:1850, forecastQty:1800, unitCost:420 },
        { material:"Paint (Latex)", unit:"gal", actualQty:620, forecastQty:600, unitCost:520 },
        { material:"Ceiling Board", unit:"sqm", actualQty:1400, forecastQty:1350, unitCost:180 },
      ]},
    ],
  },
  {
    id:102, name:"Marikina Valley Mall", location:"Marikina City", type:"Commercial",
    startDate:"2021-03-01", endDate:"2023-08-30", budget:85000000, spent:83200000,
    manager:"Ana Bonifacio", notes:"4-level commercial mall with basement parking.",
    phases:[
      { name:"Site Preparation", duration:"2 months", materials:[
        { material:"Gravel Fill", unit:"m³", actualQty:480, forecastQty:500, unitCost:950 },
        { material:"Portland Cement", unit:"bags", actualQty:420, forecastQty:400, unitCost:290 },
      ]},
      { name:"Foundation", duration:"5 months", materials:[
        { material:"Portland Cement (40kg)", unit:"bags", actualQty:6800, forecastQty:6500, unitCost:290 },
        { material:"Deformed Bars 20mm", unit:"pcs", actualQty:2400, forecastQty:2300, unitCost:940 },
        { material:"Ready-mix Concrete", unit:"m³", actualQty:820, forecastQty:800, unitCost:5800 },
      ]},
      { name:"Structural Steel", duration:"7 months", materials:[
        { material:"W-Flange Beams 200x100", unit:"pcs", actualQty:380, forecastQty:360, unitCost:4200 },
        { material:"Steel Columns 150x150", unit:"pcs", actualQty:120, forecastQty:115, unitCost:6800 },
        { material:"Metal Deck Sheet", unit:"sqm", actualQty:4800, forecastQty:4600, unitCost:280 },
      ]},
      { name:"Interior & Finishing", duration:"8 months", materials:[
        { material:"Granite Floor Tiles", unit:"sqm", actualQty:8200, forecastQty:8000, unitCost:650 },
        { material:"Gypsum Board", unit:"sqm", actualQty:5400, forecastQty:5200, unitCost:220 },
        { material:"Paint (Interior)", unit:"gal", actualQty:1800, forecastQty:1750, unitCost:520 },
      ]},
    ],
  },
  {
    id:103, name:"C6 Road Overpass", location:"Pasig-Taguig Boundary", type:"Infrastructure",
    startDate:"2022-06-01", endDate:"2024-03-15", budget:32000000, spent:31500000,
    manager:"Carlos Reyes", notes:"Single-span highway overpass. DPWH standard. 28m span.",
    phases:[
      { name:"Foundation & Piers", duration:"6 months", materials:[
        { material:"Portland Cement (40kg)", unit:"bags", actualQty:4200, forecastQty:4000, unitCost:290 },
        { material:"Deformed Bars 25mm", unit:"pcs", actualQty:980, forecastQty:950, unitCost:1250 },
        { material:"Ready-mix Concrete C40", unit:"m³", actualQty:560, forecastQty:540, unitCost:6200 },
      ]},
      { name:"Structural Deck", duration:"5 months", materials:[
        { material:"Deformed Bars 16mm", unit:"pcs", actualQty:1800, forecastQty:1750, unitCost:580 },
        { material:"Ready-mix Concrete C35", unit:"m³", actualQty:380, forecastQty:360, unitCost:5900 },
        { material:"Prestressed Girders", unit:"pcs", actualQty:12, forecastQty:12, unitCost:280000 },
      ]},
      { name:"Asphalt & Safety", duration:"3 months", materials:[
        { material:"Asphalt Concrete", unit:"tonnes", actualQty:280, forecastQty:260, unitCost:4200 },
        { material:"Guardrail Beam", unit:"pcs", actualQty:120, forecastQty:115, unitCost:1800 },
      ]},
    ],
  },
  {
    id:104, name:"BGC Residential Tower A", location:"BGC, Taguig", type:"Residential",
    startDate:"2020-09-01", endDate:"2023-12-31", budget:95000000, spent:94100000,
    manager:"Jose Lim", notes:"24-storey residential high-rise. RC shear wall system.",
    phases:[
      { name:"Foundation & Pit", duration:"6 months", materials:[
        { material:"Portland Cement (40kg)", unit:"bags", actualQty:8400, forecastQty:8000, unitCost:290 },
        { material:"Deformed Bars 25mm", unit:"pcs", actualQty:3200, forecastQty:3000, unitCost:1250 },
        { material:"Ready-mix Concrete C40", unit:"m³", actualQty:1200, forecastQty:1150, unitCost:6200 },
      ]},
      { name:"Structural", duration:"18 months", materials:[
        { material:"Portland Cement (40kg)", unit:"bags", actualQty:21800, forecastQty:21000, unitCost:290 },
        { material:"Deformed Bars 16mm", unit:"pcs", actualQty:11000, forecastQty:10600, unitCost:580 },
        { material:"CHB 4-inch", unit:"pcs", actualQty:80000, forecastQty:76000, unitCost:14 },
      ]},
      { name:"MEP & Finishing", duration:"12 months", materials:[
        { material:"Floor Tiles 60x60", unit:"sqm", actualQty:12000, forecastQty:11500, unitCost:420 },
        { material:"PVC Pipes 2-inch", unit:"length", actualQty:1800, forecastQty:1750, unitCost:180 },
        { material:"Aluminum Windows", unit:"sqm", actualQty:3200, forecastQty:3100, unitCost:2800 },
      ]},
    ],
  },
  {
    id:105, name:"Manila Water Treatment Facility", location:"Paco, Manila", type:"Industrial",
    startDate:"2021-01-15", endDate:"2023-05-30", budget:58000000, spent:57300000,
    manager:"Ben Torres", notes:"Municipal water treatment plant with tanks and pump house.",
    phases:[
      { name:"Foundation & Waterproofing", duration:"4 months", materials:[
        { material:"Portland Cement (40kg)", unit:"bags", actualQty:3800, forecastQty:3600, unitCost:290 },
        { material:"Waterproofing Membrane", unit:"sqm", actualQty:1800, forecastQty:1750, unitCost:380 },
        { material:"Ready-mix Concrete C35", unit:"m³", actualQty:420, forecastQty:400, unitCost:5900 },
      ]},
      { name:"Structural & Tanks", duration:"8 months", materials:[
        { material:"Portland Cement (40kg)", unit:"bags", actualQty:5200, forecastQty:5000, unitCost:290 },
        { material:"GI Pipes 6-inch", unit:"length", actualQty:480, forecastQty:460, unitCost:2200 },
        { material:"Waterproofing Admixture", unit:"pails", actualQty:280, forecastQty:260, unitCost:1800 },
      ]},
      { name:"Equipment & Commissioning", duration:"8 months", materials:[
        { material:"Stainless Steel Pipes", unit:"length", actualQty:320, forecastQty:310, unitCost:1800 },
        { material:"Valve Gate 4-inch", unit:"pcs", actualQty:48, forecastQty:45, unitCost:3500 },
        { material:"Electrical Conduit", unit:"length", actualQty:680, forecastQty:660, unitCost:180 },
      ]},
    ],
  },
];

// ── Accuracy metrics ──────────────────────────────────────────────────────────

const ACCURACY_METRICS = (() => {
  let totalAPE = 0, totalAbs = 0, count = 0;
  const perProject: { name: string; type: string; accuracy: number }[] = [];
  INIT_FINISHED.forEach(fp => {
    let pAPE = 0, pC = 0;
    fp.phases.forEach(ph => ph.materials.forEach(m => {
      const ape = Math.abs(m.actualQty - m.forecastQty) / m.actualQty * 100;
      totalAPE += ape; totalAbs += Math.abs(m.actualQty - m.forecastQty); count++; pAPE += ape; pC++;
    }));
    perProject.push({ name: fp.name, type: fp.type, accuracy: parseFloat((100 - pAPE / pC).toFixed(1)) });
  });
  return { accuracy: parseFloat((100 - totalAPE / count).toFixed(1)), mape: parseFloat((totalAPE / count).toFixed(1)), mae: Math.round(totalAbs / count), perProject };
})();

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseBudgetNum(s: string): number {
  const cleaned = s.replace(/[₱,\s]/g, "");
  const num = parseFloat(cleaned) || 0;
  if (cleaned.toUpperCase().endsWith("M")) return num * 1_000_000;
  if (cleaned.toUpperCase().endsWith("K")) return num * 1_000;
  return num;
}

interface ForecastPhase { name: string; materials: { material: string; unit: string; qty: number; unitCost: number; total: number }[] }
function generateAIForecast(project: Project, repo: FinishedProject[]): { phases: ForecastPhase[]; confidence: number; refs: string[]; scale: number } {
  const similar = repo.filter(fp => fp.type === project.type);
  const pool = similar.length > 0 ? similar : repo;
  const confidence = similar.length >= 2 ? 91 : similar.length === 1 ? 78 : 62;
  const targetBudget = parseBudgetNum(project.budget);
  const avgSpent = pool.reduce((s, p) => s + p.spent, 0) / pool.length;
  const scale = targetBudget / avgSpent;
  const phaseMap = new Map<string, { mats: Map<string, PhaseMat & { count: number }>; count: number }>();
  pool.forEach(fp => fp.phases.forEach(ph => {
    if (!phaseMap.has(ph.name)) phaseMap.set(ph.name, { mats: new Map(), count: 0 });
    const entry = phaseMap.get(ph.name)!; entry.count++;
    ph.materials.forEach(m => {
      if (!entry.mats.has(m.material)) entry.mats.set(m.material, { ...m, count: 0 });
      const em = entry.mats.get(m.material)!; em.actualQty += m.actualQty; em.forecastQty += m.forecastQty; em.count++;
    });
  }));
  const phases: ForecastPhase[] = [];
  phaseMap.forEach((val, phaseName) => {
    const materials: ForecastPhase["materials"] = [];
    val.mats.forEach(m => {
      const avg = m.actualQty / m.count;
      const qty = Math.round(avg * scale);
      materials.push({ material: m.material, unit: m.unit, qty, unitCost: m.unitCost, total: qty * m.unitCost });
    });
    phases.push({ name: phaseName, materials });
  });
  return { phases, confidence, refs: pool.map(p => p.name), scale: parseFloat(scale.toFixed(2)) };
}

// ── API ───────────────────────────────────────────────────────────────────────

interface ProjectResponseDto {
  id: number; name: string; type: string; location: string;
  description?: string; budget: number; startDate: string;
  targetEndDate: string; status: string;
  projectManagerName: string; siteEngineerName?: string;
  phases: unknown[];
}
const STATUS_MAP: Record<string, ProjectStatus> = { Planning:"PLANNING", Active:"ACTIVE", OnHold:"ON HOLD", Completed:"COMPLETED", Cancelled:"COMPLETED" };
const PROGRESS_COLOR: Record<string, string> = { PLANNING:"#374151", ACTIVE:"#f97316", COMPLETED:"#22c55e", "ON HOLD":"#d97706" };

function toProject(dto: ProjectResponseDto): Project {
  const status = (STATUS_MAP[dto.status] ?? "PLANNING") as ProjectStatus;
  const demo = INIT_PROJECTS.find(p => p.name === dto.name);
  return {
    id: dto.id, name: dto.name, location: dto.location, type: dto.type,
    startDate: dto.startDate.split("T")[0], endDate: dto.targetEndDate.split("T")[0], status,
    progress:      demo?.progress      ?? (status==="COMPLETED"?100:status==="ACTIVE"?50:10),
    progressColor: demo?.progressColor ?? PROGRESS_COLOR[status] ?? "#374151",
    budget: `₱${Number(dto.budget).toLocaleString()}`,
    spent:     demo?.spent     ?? "₱0",
    materials: demo?.materials ?? 0,
    manager:   demo?.manager   ?? dto.projectManagerName,
    engineers: demo?.engineers ?? (dto.siteEngineerName ? [dto.siteEngineerName] : []),
    bom: demo?.bom ?? [], forecastReady: demo?.forecastReady ?? false,
  };
}

const STATUS_STYLE: Record<ProjectStatus, { bg: string; color: string }> = {
  ACTIVE:    { bg:"#dcfce7", color:"#15803d" },
  PLANNING:  { bg:"#ffedd5", color:"#c2410c" },
  COMPLETED: { bg:"#f3f4f6", color:"#374151" },
  "ON HOLD": { bg:"#fef3c7", color:"#b45309" },
};

const inp: React.CSSProperties = {
  background:"#111827", color:"#fff", border:"none", borderRadius:8,
  padding:"10px 12px", fontSize:"0.875rem", outline:"none",
  width:"100%", boxSizing:"border-box" as const,
};

// ── Overlay ───────────────────────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:"1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ maxHeight:"90vh", overflowY:"auto" }}>
        {children}
      </div>
    </div>
  );
}

// ── Choice Modal ──────────────────────────────────────────────────────────────

function ChoiceModal({ onNew, onFinished, onClose }: { onNew: ()=>void; onFinished: ()=>void; onClose: ()=>void }) {
  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"2rem", width:420 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.5rem" }}>
          <p style={{ fontWeight:800, fontSize:"1.05rem" }}>Add Project</p>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.875rem" }}>
          <button onClick={onNew} style={{ padding:"1.5rem 1rem", borderRadius:12, border:"2px solid #f97316", background:"#fff7ed", cursor:"pointer", textAlign:"left" }}>
            <Plus style={{ width:22, height:22, color:"#f97316", marginBottom:8 }} />
            <p style={{ fontWeight:700, fontSize:"0.875rem" }}>New Project</p>
            <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginTop:4, lineHeight:1.4 }}>Start tracking a new project from day one.</p>
          </button>
          <button onClick={onFinished} style={{ padding:"1.5rem 1rem", borderRadius:12, border:"2px solid #6366f1", background:"#eef2ff", cursor:"pointer", textAlign:"left" }}>
            <Archive style={{ width:22, height:22, color:"#6366f1", marginBottom:8 }} />
            <p style={{ fontWeight:700, fontSize:"0.875rem" }}>Add Finished Project</p>
            <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginTop:4, lineHeight:1.4 }}>Upload a completed project for the forecasting database.</p>
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── New Project Modal ─────────────────────────────────────────────────────────

function NewProjectModal({ onClose, onCreate }: { onClose: ()=>void; onCreate: (p: Project)=>void }) {
  const [name, setName] = useState(""); const [type, setType] = useState("Renovation");
  const [location, setLocation] = useState(""); const [budget, setBudget] = useState("1500000");
  const [startDate, setStartDate] = useState("2026-05-05"); const [endDate, setEndDate] = useState("2026-08-08");
  const [contractor, setContractor] = useState(""); const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const sel: React.CSSProperties = { ...inp, cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"] };

  async function handleCreate() {
    if (!name.trim() || !location.trim()) { toast.error("Name and location are required."); return; }
    setSaving(true);
    try {
      const budgetNum = parseFloat(budget.replace(/[^0-9.]/g,"")) || 0;
      const { data } = await api.post<ProjectResponseDto>("/projects", { name:name.trim(), type, location:location.trim(), description:description||null, budget:budgetNum, startDate:new Date(startDate).toISOString(), targetEndDate:new Date(endDate).toISOString(), assignedContractor:contractor||null, siteEngineerId:null, phases:[] });
      toast.success(`Project "${data.name}" created!`); onCreate(toProject(data)); onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? "Failed to create project.");
    } finally { setSaving(false); }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:520 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
          <p style={{ fontWeight:800, fontSize:"1.05rem" }}>New Project</p>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Project Name *</p><input value={name} onChange={e=>setName(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Type *</p><select value={type} onChange={e=>setType(e.target.value)} style={sel}>{["Renovation","Commercial","Industrial","Infrastructure","Residential"].map(t=><option key={t}>{t}</option>)}</select></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Location *</p><input value={location} onChange={e=>setLocation(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Budget (₱)</p><input type="number" value={budget} onChange={e=>setBudget(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Start Date *</p><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>End Date *</p><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div style={{ gridColumn:"1/-1" }}><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Contractor</p><input value={contractor} onChange={e=>setContractor(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div style={{ gridColumn:"1/-1" }}><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Description</p><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={2} style={{ ...inp, resize:"vertical" as React.CSSProperties["resize"] }} suppressHydrationWarning /></div>
        </div>
        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleCreate} disabled={saving} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer", opacity:saving?0.7:1 }}>{saving?"Creating…":"Create Project"}</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Edit Project Modal ────────────────────────────────────────────────────────

function EditProjectModal({ project, onClose, onSave }: { project: Project; onClose: ()=>void; onSave: (updated: Partial<Project>)=>void }) {
  const [name,      setName]      = useState(project.name);
  const [location,  setLocation]  = useState(project.location);
  const [type,      setType]      = useState(project.type);
  const [status,    setStatus]    = useState<ProjectStatus>(project.status);
  const [progress,  setProgress]  = useState(String(project.progress));
  const [budget,    setBudget]    = useState(project.budget.replace(/[₱,M]/g,"").trim());
  const [endDate,   setEndDate]   = useState(project.endDate);
  const [manager,   setManager]   = useState(project.manager);

  const sel: React.CSSProperties = { ...inp, appearance:"none" as React.CSSProperties["appearance"], cursor:"pointer" };
  const PROG_COLOR: Record<ProjectStatus, string> = { ACTIVE:"#f97316", PLANNING:"#374151", COMPLETED:"#22c55e", "ON HOLD":"#d97706" };

  function handleSave() {
    if (!name.trim() || !location.trim()) { toast.error("Name and location required."); return; }
    onSave({
      name: name.trim(), location: location.trim(), type, status,
      progress: Math.max(0, Math.min(100, Number(progress) || 0)),
      progressColor: PROG_COLOR[status],
      budget: `₱${parseFloat(budget.replace(/[^0-9.]/g,""))||0}`,
      endDate, manager,
    });
    toast.success("Project updated!");
    onClose();
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:520 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <Pencil style={{ width:17, height:17, color:"#f97316" }} />
            <p style={{ fontWeight:800, fontSize:"1.05rem" }}>Edit Project</p>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
          <div style={{ gridColumn:"1/-1" }}><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Project Name *</p><input value={name} onChange={e=>setName(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Type</p><select value={type} onChange={e=>setType(e.target.value)} style={sel}>{["Renovation","Commercial","Industrial","Infrastructure","Residential"].map(t=><option key={t}>{t}</option>)}</select></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Status</p><select value={status} onChange={e=>setStatus(e.target.value as ProjectStatus)} style={sel}>{(["ACTIVE","PLANNING","ON HOLD","COMPLETED"] as ProjectStatus[]).map(s=><option key={s}>{s}</option>)}</select></div>
          <div style={{ gridColumn:"1/-1" }}><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Location *</p><input value={location} onChange={e=>setLocation(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Progress (%)</p><input type="number" min={0} max={100} value={progress} onChange={e=>setProgress(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Budget (₱)</p><input value={budget} onChange={e=>setBudget(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>End Date</p><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Project Manager</p><input value={manager} onChange={e=>setManager(e.target.value)} style={inp} suppressHydrationWarning /></div>
        </div>
        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>Save Changes</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Add Finished Modal ────────────────────────────────────────────────────────

function AddFinishedModal({ onClose, onAdd }: { onClose: ()=>void; onAdd: (fp: FinishedProject)=>void }) {
  const [name, setName] = useState(""); const [type, setType] = useState("Infrastructure");
  const [location, setLocation] = useState(""); const [manager, setManager] = useState("");
  const [startDate, setStartDate] = useState("2022-01-01"); const [endDate, setEndDate] = useState("2024-01-01");
  const [budget, setBudget] = useState(""); const [spent, setSpent] = useState(""); const [notes, setNotes] = useState("");
  const sel: React.CSSProperties = { ...inp, appearance:"none" as React.CSSProperties["appearance"], cursor:"pointer" };

  function handleSave() {
    if (!name.trim() || !location.trim()) { toast.error("Name and location are required."); return; }
    const fp: FinishedProject = { id:Date.now(), name:name.trim(), location:location.trim(), type, startDate, endDate, budget:parseFloat(budget)||0, spent:parseFloat(spent)||0, manager:manager||"Unknown", notes:notes||"—", phases:[] };
    onAdd(fp); toast.success(`"${fp.name}" added to Finished Repository!`); onClose();
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:500 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}><Archive style={{ width:17, height:17, color:"#6366f1" }} /><p style={{ fontWeight:800, fontSize:"1.05rem" }}>Add Finished Project</p></div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <div style={{ background:"#eef2ff", border:"1px solid #c7d2fe", borderRadius:8, padding:"0.625rem 1rem", marginBottom:"1rem" }}>
          <p style={{ fontSize:"0.78rem", color:"#4338ca" }}>Saved projects feed the AI forecasting engine for future material estimates.</p>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Project Name *</p><input value={name} onChange={e=>setName(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Type</p><select value={type} onChange={e=>setType(e.target.value)} style={sel}>{["Infrastructure","Commercial","Residential","Industrial","Renovation"].map(t=><option key={t}>{t}</option>)}</select></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Location *</p><input value={location} onChange={e=>setLocation(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Manager</p><input value={manager} onChange={e=>setManager(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Start Date</p><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>End Date</p><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Budget (₱)</p><input type="number" value={budget} onChange={e=>setBudget(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Actual Spent (₱)</p><input type="number" value={spent} onChange={e=>setSpent(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div style={{ gridColumn:"1/-1" }}><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Notes</p><textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} style={{ ...inp, resize:"vertical" as React.CSSProperties["resize"] }} suppressHydrationWarning /></div>
        </div>
        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#6366f1", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>Save to Repository</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Material Plan Modal ───────────────────────────────────────────────────────

const EMPTY_ROW = (): BOMRow => ({ material:"", unit:"pcs", qty:0, unitCost:0, supplier:"" });

function MaterialPlanModal({ project, onClose, onSaveBOM, onRunForecast, extraRows }: {
  project: Project; onClose: ()=>void;
  onSaveBOM: (bom: BOMRow[])=>void;
  onRunForecast: (bom: BOMRow[])=>void;
  extraRows?: BOMRow[];
}) {
  const [phase,   setPhase]   = useState("Foundation");
  const [period,  setPeriod]  = useState("30 days");
  const [reorder, setReorder] = useState("20");
  const [lead,    setLead]    = useState("7");
  const [bomSaved, setBomSaved] = useState(false);

  const buildInitRows = (): BOMRow[] => {
    const existing = project.bom.length > 0 ? [...project.bom] : [];
    const extra    = extraRows && extraRows.length > 0 ? [...extraRows] : [];
    const merged   = [...existing, ...extra];
    if (merged.length === 0) return [EMPTY_ROW(), EMPTY_ROW(), EMPTY_ROW(), EMPTY_ROW(), EMPTY_ROW()];
    while (merged.length < 3) merged.push(EMPTY_ROW());
    return merged;
  };

  const [rows, setRows] = useState<BOMRow[]>(buildInitRows);
  const total = rows.reduce((s, r) => s + r.qty * r.unitCost, 0);
  const validRows = rows.filter(r => r.material.trim());

  function updateRow(i: number, field: keyof BOMRow, val: string | number) {
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
  }
  function removeRow(i: number) { setRows(r => r.filter((_, idx) => idx !== i)); }

  const cell: React.CSSProperties = { ...inp, padding:"7px 8px", fontSize:"0.78rem" };

  if (bomSaved) {
    return (
      <Overlay onClose={onClose}>
        <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:700 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <CheckCircle2 style={{ width:20, height:20, color:"#22c55e" }} />
              <div>
                <p style={{ fontWeight:800, fontSize:"1.05rem" }}>BOM Saved — {project.name}</p>
                <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginTop:1 }}>{validRows.length} materials · Total: ₱{total.toLocaleString()}</p>
              </div>
            </div>
            <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
          </div>

          <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:8, padding:"0.625rem 1rem", marginBottom:"1rem" }}>
            <p style={{ fontSize:"0.78rem", color:"#15803d" }}>Bill of Materials has been saved to this project. Use &quot;Run Forecast&quot; to generate a demand forecast based on this BOM.</p>
          </div>

          {/* BOM list */}
          <p style={{ fontSize:"0.68rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", marginBottom:"0.5rem" }}>GENERATED BILL OF MATERIALS</p>
          <div style={{ border:"1px solid #e5e7eb", borderRadius:10, overflow:"hidden", marginBottom:"1rem" }}>
            <div style={{ display:"grid", gridTemplateColumns:"2fr 0.7fr 0.8fr 0.8fr 1fr 1.2fr", gap:4, padding:"0.625rem 1rem", background:"#f9fafb", borderBottom:"1px solid #e5e7eb" }}>
              {["Material","Unit","Qty","Unit Cost","Total","Supplier"].map(h=>(
                <span key={h} style={{ fontSize:"0.6rem", color:"#9ca3af", fontWeight:700 }}>{h}</span>
              ))}
            </div>
            {validRows.map((r, i) => (
              <div key={i} style={{ display:"grid", gridTemplateColumns:"2fr 0.7fr 0.8fr 0.8fr 1fr 1.2fr", gap:4, padding:"0.625rem 1rem", borderBottom: i < validRows.length-1 ? "1px solid #f3f4f6" : "none" }}>
                <span style={{ fontSize:"0.78rem", fontWeight:500, color:"#111827" }}>{r.material}</span>
                <span style={{ fontSize:"0.78rem", color:"#9ca3af" }}>{r.unit}</span>
                <span style={{ fontSize:"0.78rem", fontWeight:600 }}>{r.qty.toLocaleString()}</span>
                <span style={{ fontSize:"0.78rem", color:"#6b7280" }}>₱{r.unitCost.toLocaleString()}</span>
                <span style={{ fontSize:"0.78rem", fontWeight:700, color:"#f97316" }}>₱{(r.qty*r.unitCost).toLocaleString()}</span>
                <span style={{ fontSize:"0.78rem", color:"#9ca3af" }}>{r.supplier || "—"}</span>
              </div>
            ))}
          </div>

          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ background:"#fff7ed", borderRadius:8, padding:"0.5rem 1rem" }}>
              <span style={{ fontSize:"0.78rem", color:"#9ca3af" }}>Total BOM Cost: </span>
              <span style={{ fontWeight:800, color:"#f97316", fontSize:"1rem" }}>₱{total.toLocaleString()}</span>
            </div>
            <div style={{ display:"flex", gap:"0.75rem" }}>
              <button onClick={onClose} style={{ padding:"9px 18px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.8rem", cursor:"pointer" }}>Close</button>
              <button onClick={()=>{ onRunForecast(rows); onClose(); }} style={{ padding:"9px 18px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.8rem", fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}><Zap style={{ width:13, height:13 }} /> Run Forecast</button>
            </div>
          </div>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:740 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem" }}>
          <div>
            <p style={{ fontWeight:800, fontSize:"1.05rem" }}>Material Plan — <span style={{ color:"#f97316" }}>{project.name}</span></p>
            <p style={{ fontSize:"0.75rem", color:"#9ca3af", marginTop:2 }}>Bill of Materials (BOM) &amp; procurement planning</p>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:20, height:20 }} /></button>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.75rem", marginBottom:"1.25rem" }}>
          <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>PROJECT PHASE</p><input value={phase} onChange={e=>setPhase(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>PLANNING PERIOD</p><input value={period} onChange={e=>setPeriod(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>LEAD TIME (DAYS)</p><input value={lead} onChange={e=>setLead(e.target.value)} style={inp} suppressHydrationWarning /></div>
        </div>

        <p style={{ fontSize:"0.68rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", marginBottom:"0.5rem" }}>BILL OF MATERIALS</p>
        <div style={{ display:"grid", gridTemplateColumns:"2fr 0.65fr 0.65fr 0.85fr 0.9fr 1fr 28px", gap:4, marginBottom:4 }}>
          {["MATERIAL","UNIT","QTY","UNIT COST (₱)","TOTAL (₱)","SUPPLIER",""].map(h=>(
            <p key={h} style={{ fontSize:"0.6rem", color:"#9ca3af", fontWeight:700 }}>{h}</p>
          ))}
        </div>
        <div style={{ maxHeight:260, overflowY:"auto" }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"2fr 0.65fr 0.65fr 0.85fr 0.9fr 1fr 28px", gap:4, marginBottom:4, alignItems:"center" }}>
              <input value={row.material}  onChange={e=>updateRow(i,"material",e.target.value)}  placeholder="e.g. Portland Cement (40kg)" style={cell} suppressHydrationWarning />
              <select value={row.unit} onChange={e=>updateRow(i,"unit",e.target.value)} style={{ ...cell, appearance:"none" as React.CSSProperties["appearance"] }}>
                {["pcs","bags","m³","cu.m","rolls","sheets","sqm","length","kg","tonnes","gal","pails","box"].map(u=><option key={u}>{u}</option>)}
              </select>
              <input value={row.qty||""} onChange={e=>updateRow(i,"qty",Number(e.target.value))} type="number" placeholder="0" style={cell} suppressHydrationWarning />
              <input value={row.unitCost||""} onChange={e=>updateRow(i,"unitCost",Number(e.target.value))} type="number" placeholder="0" style={cell} suppressHydrationWarning />
              <div style={{ ...cell, background:"#1a2235", display:"flex", alignItems:"center", borderRadius:8 }}>
                <span style={{ color:"#f97316", fontWeight:700, fontSize:"0.78rem" }}>₱{(row.qty*row.unitCost).toLocaleString()}</span>
              </div>
              <input value={row.supplier} onChange={e=>updateRow(i,"supplier",e.target.value)} placeholder="Supplier" style={cell} suppressHydrationWarning />
              <button onClick={()=>removeRow(i)} style={{ background:"none", border:"none", cursor:"pointer", color:"#dc2626", padding:0, display:"flex", alignItems:"center", justifyContent:"center" }}><X style={{ width:14, height:14 }} /></button>
            </div>
          ))}
        </div>

        <button onClick={()=>setRows(r=>[...r, EMPTY_ROW()])} style={{ color:"#0d9488", background:"none", border:"none", cursor:"pointer", fontSize:"0.8rem", fontWeight:600, margin:"0.5rem 0 1.25rem", display:"flex", alignItems:"center", gap:4 }}>
          <Plus style={{ width:13, height:13 }} /> Add Material Row
        </button>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem", marginBottom:"1rem" }}>
          <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>REORDER POINT (%)</p><input value={reorder} onChange={e=>setReorder(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div style={{ background:"#f9fafb", borderRadius:8, padding:"0.625rem 1rem", display:"flex", flexDirection:"column", justifyContent:"center" }}>
            <p style={{ fontSize:"0.65rem", color:"#9ca3af" }}>EST. BOM TOTAL</p>
            <p style={{ fontWeight:800, fontSize:"1.1rem", color:"#f97316" }}>₱{total.toLocaleString()}</p>
          </div>
        </div>

        <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:8, padding:"0.625rem 1rem", marginBottom:"1.25rem", display:"flex", gap:8 }}>
          <Zap style={{ width:13, height:13, color:"#3b82f6", flexShrink:0, marginTop:3 }} />
          <p style={{ fontSize:"0.75rem", color:"#1d4ed8", lineHeight:1.5 }}>ConstructIQ uses this BOM alongside project schedules and historical usage to generate demand forecasts.</p>
        </div>

        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ padding:"9px 18px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.8rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={()=>{ if(validRows.length===0){toast.error("Add at least one material.");return;} onSaveBOM(rows); setBomSaved(true); }} style={{ padding:"9px 18px", borderRadius:8, border:"none", background:"#0d9488", color:"#fff", fontSize:"0.8rem", fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
            <Package style={{ width:13, height:13 }} /> Add to BOM
          </button>
          <button onClick={()=>{ if(validRows.length===0){toast.error("Add at least one material.");return;} onRunForecast(rows); onClose(); }} style={{ padding:"9px 18px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.8rem", fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
            <Zap style={{ width:13, height:13 }} /> Run Forecast
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Measurements Modal ────────────────────────────────────────────────────────

function MeasurementsModal({ project, onClose, onAddToPlan }: {
  project: Project; onClose: ()=>void;
  onAddToPlan: (rows: BOMRow[])=>void;
}) {
  const [structType, setStructType] = useState<"Floor Slab"|"Wall"|"Column">("Floor Slab");
  const [label,     setLabel]     = useState("");
  const [length,    setLength]    = useState("");
  const [width,     setWidth]     = useState("");
  const [thickness, setThickness] = useState("0.10");
  const [mixRatio,  setMixRatio]  = useState("1:2:4 (Standard)");
  const [results,   setResults]   = useState<null|{cement:number;sand:number;gravel:number}>(null);

  function calculate() {
    const L = parseFloat(length)||0, W = parseFloat(width)||0, T = parseFloat(thickness)||0;
    const vol = L * W * T;
    setResults({ cement: Math.ceil(vol * 8), sand: parseFloat((vol * 0.44).toFixed(2)), gravel: parseFloat((vol * 0.88).toFixed(2)) });
  }

  function handleAddToPlan() {
    if (!results) { toast.error("Calculate first."); return; }
    const rows: BOMRow[] = [
      { material:"Portland Cement (40kg)", unit:"bags", qty:results.cement, unitCost:290, supplier:"" },
      { material:"Fine Sand",              unit:"m³",   qty:results.sand,   unitCost:900, supplier:"" },
      { material:"Coarse Gravel",          unit:"m³",   qty:results.gravel, unitCost:1200,supplier:"" },
    ];
    onAddToPlan(rows);
    onClose();
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:580 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}><Ruler style={{ width:17, height:17, color:"#f97316" }} /><p style={{ fontWeight:800, fontSize:"1.05rem" }}>Material Measurement Calculator</p></div>
            <p style={{ fontSize:"0.75rem", color:"#9ca3af", marginTop:2 }}>{project.name} — site measurement &amp; quantity estimation</p>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:20, height:20 }} /></button>
        </div>

        <p style={{ fontSize:"0.68rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", marginBottom:"0.5rem" }}>STRUCTURE TYPE</p>
        <div style={{ display:"flex", background:"#111827", borderRadius:10, padding:4, width:"fit-content", marginBottom:"1.25rem" }}>
          {(["Floor Slab","Wall","Column"] as const).map(t=>(
            <button key={t} onClick={()=>setStructType(t)} style={{ padding:"7px 18px", borderRadius:8, border:"none", cursor:"pointer", fontSize:"0.875rem", fontWeight:500, background:structType===t?"#fff":"transparent", color:structType===t?"#111827":"#9ca3af", transition:"all 0.15s" }}>{t}</button>
          ))}
        </div>

        <div style={{ marginBottom:"0.75rem" }}>
          <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>STRUCTURE / AREA LABEL</p>
          <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. Ground Floor — Zone A" style={inp} suppressHydrationWarning />
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.75rem", marginBottom:"0.75rem" }}>
          <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>LENGTH (M)</p><input value={length} onChange={e=>setLength(e.target.value)} type="number" placeholder="0.00" style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>WIDTH (M)</p><input value={width} onChange={e=>setWidth(e.target.value)} type="number" placeholder="0.00" style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>THICKNESS (M)</p><input value={thickness} onChange={e=>setThickness(e.target.value)} type="number" style={inp} suppressHydrationWarning /></div>
        </div>

        <div style={{ marginBottom:"1rem" }}>
          <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:4 }}>CONCRETE MIX RATIO</p>
          <select value={mixRatio} onChange={e=>setMixRatio(e.target.value)} style={{ ...inp, appearance:"none" as React.CSSProperties["appearance"], cursor:"pointer" }}>
            <option>1:2:4 (Standard)</option>
            <option>1:1.5:3 (Rich Mix)</option>
            <option>1:3:6 (Lean Mix)</option>
          </select>
        </div>

        <button onClick={calculate} style={{ width:"100%", padding:"11px", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.875rem", fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:"0.875rem" }}>
          <Calculator style={{ width:15, height:15 }} /> Calculate Material Requirements
        </button>

        {results && (
          <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:10, padding:"1rem", marginBottom:"1rem" }}>
            <p style={{ fontSize:"0.75rem", fontWeight:700, color:"#15803d", marginBottom:"0.75rem" }}>Calculated Requirements (no waste buffer)</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.5rem" }}>
              {([["Portland Cement (40kg)","bags",results.cement,"#f97316"],["Fine Sand","m³",results.sand,"#22c55e"],["Coarse Gravel","m³",results.gravel,"#3b82f6"]] as [string,string,number,string][]).map(([n,u,v,c])=>(
                <div key={n} style={{ background:"#fff", borderRadius:8, padding:"0.75rem", textAlign:"center" }}>
                  <p style={{ fontSize:"1.1rem", fontWeight:800, color:c }}>{v}</p>
                  <p style={{ fontSize:"0.65rem", color:"#6b7280" }}>{u}</p>
                  <p style={{ fontSize:"0.65rem", color:"#9ca3af" }}>{n}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <p style={{ fontSize:"0.72rem", color:"#9ca3af" }}>Follows DPWH standard mix ratios</p>
          <div style={{ display:"flex", gap:"0.75rem" }}>
            <button onClick={onClose} style={{ padding:"9px 18px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.8rem", cursor:"pointer" }}>Cancel</button>
            <button onClick={handleAddToPlan} disabled={!results} style={{ padding:"9px 18px", borderRadius:8, border:"none", background:results?"#0d9488":"#e5e7eb", color:results?"#fff":"#9ca3af", fontSize:"0.8rem", fontWeight:700, cursor:results?"pointer":"default", display:"flex", alignItems:"center", gap:6 }}>
              <Package style={{ width:13, height:13 }} /> Add to Material Plan
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

// ── Forecast Modal ────────────────────────────────────────────────────────────

function ForecastModal({ project, onClose }: { project: Project; onClose: ()=>void }) {
  const weeks = ["Wk 1","Wk 2","Wk 3","Wk 4","Wk 5","Wk 6","Wk 7","Wk 8"];
  const data = weeks.map((wk, i) => {
    const row: Record<string, string|number> = { week: wk };
    project.bom.slice(0,3).forEach(b => {
      const curve = Math.sin((i/7)*Math.PI)*0.6+0.4;
      row[b.material.split(" ")[0]] = Math.round((b.qty/8)*(i+1)*0.8*curve);
    });
    return row;
  });
  const colors = ["#f97316","#22c55e","#3b82f6"];
  const keys = project.bom.slice(0,3).map(b=>b.material.split(" ")[0]);
  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:660 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"1.25rem" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}><Zap style={{ width:17, height:17, color:"#f97316" }} /><p style={{ fontWeight:800, fontSize:"1.05rem" }}>Simulated Material Forecast</p></div>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>{project.name} — 8-week material consumption projection</p>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top:4, right:8, left:-20, bottom:0 }}>
            <defs>{keys.map((k,i)=>(<linearGradient key={k} id={`g${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={colors[i]} stopOpacity={0.3}/><stop offset="95%" stopColor={colors[i]} stopOpacity={0}/></linearGradient>))}</defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
            <XAxis dataKey="week" tick={{ fontSize:11, fill:"#9ca3af" }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fontSize:11, fill:"#9ca3af" }} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={{ borderRadius:8, border:"1px solid #e5e7eb", fontSize:"0.72rem" }}/>
            <Legend iconType="plainline" wrapperStyle={{ fontSize:"0.72rem", paddingTop:8 }}/>
            {keys.map((k,i)=>(<Area key={k} type="monotone" dataKey={k} stroke={colors[i]} strokeWidth={2} fill={`url(#g${i})`}/>))}
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ display:"grid", gridTemplateColumns:`repeat(${keys.length},1fr)`, gap:"0.75rem", marginTop:"1rem" }}>
          {project.bom.slice(0,3).map((b,i)=>(
            <div key={b.material} style={{ background:"#f9fafb", borderRadius:10, padding:"0.875rem" }}>
              <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>{b.material}</p>
              <p style={{ fontWeight:700, fontSize:"1rem", color:colors[i] }}>{b.qty} {b.unit}</p>
              <p style={{ fontSize:"0.65rem", color:"#9ca3af" }}>Peak: Week {i+4}</p>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", justifyContent:"flex-end", marginTop:"1rem" }}>
          <button onClick={onClose} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontWeight:700, fontSize:"0.875rem", cursor:"pointer" }}>Done</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── AI Forecast Modal ─────────────────────────────────────────────────────────

function AIForecastModal({ project, repo, onClose }: { project: Project; repo: FinishedProject[]; onClose: ()=>void }) {
  const { phases, confidence, refs, scale } = generateAIForecast(project, repo);
  const totalEst = phases.reduce((s, ph) => s + ph.materials.reduce((ms, m) => ms + m.total, 0), 0);
  const [expanded, setExpanded] = useState<string[]>([phases[0]?.name ?? ""]);
  const toggle = (n: string) => setExpanded(p => p.includes(n) ? p.filter(x=>x!==n) : [...p, n]);

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:680 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"1rem" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}><Brain style={{ width:17, height:17, color:"#f97316" }} /><p style={{ fontWeight:800, fontSize:"1.05rem" }}>AI Material Forecast</p></div>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>{project.name} — based on {refs.length} historical project{refs.length!==1?"s":""}</p>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.75rem", marginBottom:"1rem" }}>
          {[{l:"Confidence",v:`${confidence}%`,c:"#22c55e",bg:"#f0fdf4"},{l:"Budget Scale",v:`${scale}×`,c:"#f97316",bg:"#fff7ed"},{l:"Est. Materials Cost",v:`₱${(totalEst/1_000_000).toFixed(1)}M`,c:"#3b82f6",bg:"#eff6ff"}].map(s=>(
            <div key={s.l} style={{ background:s.bg, borderRadius:10, padding:"0.875rem", textAlign:"center" }}>
              <p style={{ fontSize:"1.2rem", fontWeight:800, color:s.c }}>{s.v}</p>
              <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginTop:2 }}>{s.l}</p>
            </div>
          ))}
        </div>
        <div style={{ background:"#f9fafb", borderRadius:8, padding:"0.625rem 1rem", marginBottom:"1rem" }}>
          <p style={{ fontSize:"0.78rem", color:"#374151" }}>References: {refs.map((r,i)=><span key={r}><strong>{r}</strong>{i<refs.length-1?", ":""}</span>)}</p>
        </div>
        <div style={{ border:"1px solid #e5e7eb", borderRadius:10, overflow:"hidden", marginBottom:"1rem" }}>
          {phases.map((ph, pi) => {
            const open = expanded.includes(ph.name);
            const phTotal = ph.materials.reduce((s,m)=>s+m.total,0);
            return (
              <div key={ph.name} style={{ borderBottom: pi<phases.length-1?"1px solid #e5e7eb":"none" }}>
                <button onClick={()=>toggle(ph.name)} style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0.75rem 1rem", background:"#f9fafb", border:"none", cursor:"pointer" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ width:20, height:20, borderRadius:6, background:"#f97316", color:"#fff", fontSize:"0.62rem", fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center" }}>{pi+1}</span>
                    <span style={{ fontWeight:600, fontSize:"0.875rem" }}>{ph.name}</span>
                    <span style={{ fontSize:"0.7rem", color:"#9ca3af" }}>({ph.materials.length} materials)</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ fontSize:"0.82rem", fontWeight:700, color:"#f97316" }}>₱{phTotal.toLocaleString()}</span>
                    {open?<ChevronUp style={{ width:15,height:15,color:"#9ca3af" }}/>:<ChevronDown style={{ width:15,height:15,color:"#9ca3af" }}/>}
                  </div>
                </button>
                {open && (
                  <div style={{ padding:"0 1rem 0.75rem" }}>
                    <div style={{ display:"grid", gridTemplateColumns:"2fr 0.6fr 0.8fr 0.8fr 1fr", gap:4, padding:"0.5rem 0", borderBottom:"1px solid #f3f4f6", marginBottom:4 }}>
                      {["Material","Unit","AI Qty","Unit Cost","Est. Total"].map(h=><span key={h} style={{ fontSize:"0.6rem", color:"#9ca3af", fontWeight:700 }}>{h}</span>)}
                    </div>
                    {ph.materials.map(m=>(
                      <div key={m.material} style={{ display:"grid", gridTemplateColumns:"2fr 0.6fr 0.8fr 0.8fr 1fr", gap:4, padding:"4px 0", borderBottom:"1px solid #f9fafb" }}>
                        <span style={{ fontSize:"0.78rem", color:"#374151" }}>{m.material}</span>
                        <span style={{ fontSize:"0.78rem", color:"#9ca3af" }}>{m.unit}</span>
                        <span style={{ fontSize:"0.78rem", fontWeight:600 }}>{m.qty.toLocaleString()}</span>
                        <span style={{ fontSize:"0.78rem", color:"#9ca3af" }}>₱{m.unitCost.toLocaleString()}</span>
                        <span style={{ fontSize:"0.78rem", fontWeight:700, color:"#f97316" }}>₱{m.total.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display:"flex", justifyContent:"flex-end", gap:"0.75rem" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:"pointer" }}>Close</button>
          <button onClick={()=>{ toast.success("Forecast exported!"); onClose(); }} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>Export Forecast</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Reports Modal ─────────────────────────────────────────────────────────────

function ReportsModal({ project, onClose }: { project: Project; onClose: ()=>void }) {
  const [reportType, setReportType] = useState("Inventory Stock"); const [fromDate, setFromDate] = useState("2026-05-01"); const [toDate, setToDate] = useState("2026-06-01");
  const [selProject, setSelProject] = useState("Southgate Mall Expansion"); const [format, setFormat] = useState(".CSV");
  const [requester, setRequester] = useState("Remy Santos"); const [approver, setApprover] = useState("Ana Bonifacio");
  const [checks, setChecks] = useState({ cost:true, material:true, labor:false, audit:false });
  const dark: React.CSSProperties = { ...inp, background:"#1e2d50", border:"1px solid rgba(255,255,255,0.1)" };
  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#1a2235", borderRadius:16, padding:"1.75rem", width:500 }}>
        <div style={{ marginBottom:"1rem" }}><p style={{ fontWeight:800, fontSize:"1.05rem", color:"#fff" }}>Generate Report</p><p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>{project.name}</p></div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.75rem" }}>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Report Type</p><select value={reportType} onChange={e=>setReportType(e.target.value)} style={{ ...dark, appearance:"none" as React.CSSProperties["appearance"], width:"100%", color:"#fff" }}>{["Inventory Stock","Excess Analytics","Procurement Summary","Material Usage","Cost Report"].map(t=><option key={t}>{t}</option>)}</select></div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>From</p><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={{ ...dark, color:"#fff", width:"100%", boxSizing:"border-box" }} suppressHydrationWarning /></div>
            <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>To</p><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={{ ...dark, color:"#fff", width:"100%", boxSizing:"border-box" }} suppressHydrationWarning /></div>
          </div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Project</p><select value={selProject} onChange={e=>setSelProject(e.target.value)} style={{ ...dark, appearance:"none" as React.CSSProperties["appearance"], width:"100%", color:"#fff" }}>{["Southgate Mall Expansion","Metro Station Phase 3","BGC Tower Complex","Harbor Bridge Renovation","PUP ICTC Building"].map(p=><option key={p}>{p}</option>)}</select></div>
          <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:"0.5rem" }}>Include in Report</p>{([["cost","Cost Breakdown"],["material","Material Usage"],["labor","Labor Analysis"],["audit","Audit Log"]] as [keyof typeof checks,string][]).map(([k,label])=>(<label key={k} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", marginBottom:6 }}><input type="checkbox" checked={checks[k]} onChange={e=>setChecks(c=>({...c,[k]:e.target.checked}))} style={{ width:14, height:14, accentColor:"#22c55e" }} /><span style={{ fontSize:"0.8rem", color:"#d1d5db" }}>{label}</span></label>))}</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Format</p><select value={format} onChange={e=>setFormat(e.target.value)} style={{ ...dark, appearance:"none" as React.CSSProperties["appearance"], width:"100%", color:"#fff" }}>{[".CSV",".PDF",".XLSX"].map(f=><option key={f}>{f}</option>)}</select></div>
            <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Requested by</p><select value={requester} onChange={e=>setRequester(e.target.value)} style={{ ...dark, appearance:"none" as React.CSSProperties["appearance"], width:"100%", color:"#fff" }}>{["Remy Santos","Ana Bonifacio","Jose Reyes"].map(m=><option key={m}>{m}</option>)}</select></div>
          </div>
        </div>
        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", background:"transparent", color:"#d1d5db", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>Generate</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Finished Project Card ─────────────────────────────────────────────────────

function FinishedProjectCard({ fp }: { fp: FinishedProject }) {
  const [expanded, setExpanded] = useState(false);
  const [activePhase, setActivePhase] = useState(0);
  const accuracy = ACCURACY_METRICS.perProject.find(p=>p.name===fp.name)?.accuracy;
  const months = Math.round((new Date(fp.endDate).getTime()-new Date(fp.startDate).getTime())/(1000*60*60*24*30));
  const variance = fp.budget > 0 ? ((fp.spent-fp.budget)/fp.budget*100) : 0;
  return (
    <div style={{ background:"#fff", borderRadius:14, boxShadow:"0 1px 4px rgba(0,0,0,0.08)", overflow:"hidden" }}>
      <div style={{ padding:"1.25rem 1.25rem 0.875rem" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"0.5rem" }}>
          <p style={{ fontWeight:700, fontSize:"0.95rem", color:"#111827" }}>{fp.name}</p>
          <div style={{ display:"flex", gap:5 }}>
            <span style={{ fontSize:"0.62rem", fontWeight:700, padding:"2px 7px", borderRadius:999, background:"#f3f4f6", color:"#374151" }}>{fp.type}</span>
            <span style={{ fontSize:"0.62rem", fontWeight:700, padding:"2px 7px", borderRadius:999, background:"#dcfce7", color:"#15803d", display:"flex", alignItems:"center", gap:2 }}><CheckCircle2 style={{ width:9,height:9 }} /> COMPLETED</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:12, marginBottom:"0.875rem" }}>
          <span style={{ fontSize:"0.72rem", color:"#9ca3af", display:"flex", alignItems:"center", gap:3 }}><MapPin style={{ width:10,height:10 }} />{fp.location}</span>
          <span style={{ fontSize:"0.72rem", color:"#9ca3af", display:"flex", alignItems:"center", gap:3 }}><Calendar style={{ width:10,height:10 }} />{months} months</span>
          <span style={{ fontSize:"0.72rem", color:"#9ca3af", display:"flex", alignItems:"center", gap:3 }}><Users style={{ width:10,height:10 }} />{fp.manager}</span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:"0.5rem" }}>
          {[
            { l:"Budget",   v:`₱${(fp.budget/1_000_000).toFixed(1)}M` },
            { l:"Spent",    v:`₱${(fp.spent/1_000_000).toFixed(1)}M` },
            { l:"Variance", v:`${variance>0?"+":""}${variance.toFixed(1)}%`, c:Math.abs(variance)<5?"#22c55e":"#f97316" },
            { l:"Accuracy", v:accuracy?`${accuracy}%`:"N/A", c:"#3b82f6" },
          ].map(s=>(
            <div key={s.l} style={{ background:"#f9fafb", borderRadius:8, padding:"0.5rem 0.625rem" }}>
              <p style={{ fontSize:"0.6rem", color:"#9ca3af" }}>{s.l}</p>
              <p style={{ fontWeight:700, fontSize:"0.82rem", color:s.c??"#111827" }}>{s.v}</p>
            </div>
          ))}
        </div>
      </div>
      <button onClick={()=>setExpanded(e=>!e)} style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0.625rem 1.25rem", background:"#f9fafb", border:"none", borderTop:"1px solid #f3f4f6", cursor:"pointer" }}>
        <span style={{ fontSize:"0.72rem", fontWeight:600, color:"#374151" }}>{expanded?"Hide":"View"} Phase Breakdown ({fp.phases.length} phases)</span>
        {expanded?<ChevronUp style={{ width:14,height:14,color:"#9ca3af" }}/>:<ChevronDown style={{ width:14,height:14,color:"#9ca3af" }}/>}
      </button>
      {expanded && fp.phases.length > 0 && (
        <div style={{ padding:"1rem 1.25rem" }}>
          <div style={{ display:"flex", gap:4, marginBottom:"0.75rem", flexWrap:"wrap" }}>
            {fp.phases.map((ph,i)=>(
              <button key={ph.name} onClick={()=>setActivePhase(i)} style={{ padding:"3px 10px", borderRadius:999, fontSize:"0.72rem", border:"none", cursor:"pointer", background:activePhase===i?"#1e3154":"#f3f4f6", color:activePhase===i?"#fff":"#374151" }}>{ph.name}</button>
            ))}
          </div>
          {fp.phases[activePhase] && (
            <>
              <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginBottom:6 }}>Duration: <strong style={{ color:"#374151" }}>{fp.phases[activePhase].duration}</strong></p>
              <div style={{ display:"grid", gridTemplateColumns:"2fr 0.6fr 0.7fr 0.7fr 0.7fr 0.7fr", gap:4, paddingBottom:4, marginBottom:4, borderBottom:"1px solid #f3f4f6" }}>
                {["Material","Unit","Actual","Forecast","Unit Cost","Variance"].map(h=><span key={h} style={{ fontSize:"0.58rem", color:"#9ca3af", fontWeight:700 }}>{h}</span>)}
              </div>
              {fp.phases[activePhase].materials.map(m=>{
                const v = ((m.actualQty-m.forecastQty)/m.forecastQty*100);
                return (
                  <div key={m.material} style={{ display:"grid", gridTemplateColumns:"2fr 0.6fr 0.7fr 0.7fr 0.7fr 0.7fr", gap:4, padding:"4px 0", borderBottom:"1px solid #f9fafb" }}>
                    <span style={{ fontSize:"0.72rem", color:"#374151" }}>{m.material}</span>
                    <span style={{ fontSize:"0.72rem", color:"#9ca3af" }}>{m.unit}</span>
                    <span style={{ fontSize:"0.72rem", fontWeight:600 }}>{m.actualQty.toLocaleString()}</span>
                    <span style={{ fontSize:"0.72rem", color:"#6b7280" }}>{m.forecastQty.toLocaleString()}</span>
                    <span style={{ fontSize:"0.72rem", color:"#6b7280" }}>₱{m.unitCost.toLocaleString()}</span>
                    <span style={{ fontSize:"0.72rem", fontWeight:700, color:Math.abs(v)<5?"#22c55e":Math.abs(v)<10?"#f97316":"#dc2626" }}>{v>0?"+":""}{v.toFixed(1)}%</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
      {expanded && <div style={{ padding:"0.625rem 1.25rem", background:"#f9fafb", borderTop:"1px solid #f3f4f6" }}><p style={{ fontSize:"0.72rem", color:"#6b7280", fontStyle:"italic" }}>{fp.notes}</p></div>}
    </div>
  );
}

// ── Forecasting Tab ───────────────────────────────────────────────────────────

function ForecastingTab({ repo }: { repo: FinishedProject[] }) {
  const [genType, setGenType] = useState("Infrastructure");
  const [genBudget, setGenBudget] = useState("30000000");
  const [genResult, setGenResult] = useState<ReturnType<typeof generateAIForecast>|null>(null);
  const mock: Project = { id:0, name:"Preview", location:"—", type:genType, status:"PLANNING", budget:`₱${Number(genBudget).toLocaleString()}`, spent:"₱0", progress:0, progressColor:"#374151", materials:0, manager:"—", engineers:[], startDate:"2026-01-01", endDate:"2027-01-01", bom:[], forecastReady:false };
  const totalEst = genResult?.phases.reduce((s,ph)=>s+ph.materials.reduce((ms,m)=>ms+m.total,0),0)??0;
  const sel: React.CSSProperties = { background:"#111827", color:"#fff", border:"none", borderRadius:8, padding:"9px 12px", fontSize:"0.875rem", outline:"none", cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"], width:"100%" };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"0.875rem" }}>
        {[{icon:Target,bg:"#dcfce7",ic:"#15803d",l:"Overall Accuracy",v:`${ACCURACY_METRICS.accuracy}%`},{icon:BarChart2,bg:"#eff6ff",ic:"#1d4ed8",l:"Mean Abs. Error",v:`${ACCURACY_METRICS.mae} units`},{icon:TrendingUp,bg:"#fff7ed",ic:"#c2410c",l:"MAPE",v:`${ACCURACY_METRICS.mape}%`},{icon:Archive,bg:"#f3f4f6",ic:"#374151",l:"Projects Analyzed",v:`${repo.length}`}].map(s=>{
          const Icon = s.icon;
          return (
            <div key={s.l} style={{ background:"#fff", borderRadius:14, padding:"1.25rem", boxShadow:"0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ width:36,height:36,borderRadius:9,background:s.bg,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:"0.75rem" }}><Icon style={{ width:17,height:17,color:s.ic }} /></div>
              <p style={{ fontSize:"1.5rem", fontWeight:800, color:"#111827", lineHeight:1 }}>{s.v}</p>
              <p style={{ fontSize:"0.7rem", color:"#9ca3af", marginTop:4 }}>{s.l}</p>
            </div>
          );
        })}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem" }}>
        <div style={{ background:"#fff", borderRadius:12, padding:"1.25rem", boxShadow:"0 1px 3px rgba(0,0,0,0.07)" }}>
          <p style={{ fontWeight:700, fontSize:"0.9rem", marginBottom:"0.25rem" }}>Forecast Accuracy per Project</p>
          <p style={{ fontSize:"0.7rem", color:"#9ca3af", marginBottom:"1rem" }}>Actual vs. forecasted material quantities</p>
          {ACCURACY_METRICS.perProject.map(p=>(
            <div key={p.name} style={{ marginBottom:"0.75rem" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                <span style={{ fontSize:"0.75rem", color:"#374151", fontWeight:500 }}>{p.name}</span>
                <span style={{ fontSize:"0.75rem", fontWeight:700, color:p.accuracy>=95?"#22c55e":"#f97316" }}>{p.accuracy}%</span>
              </div>
              <div style={{ height:7, background:"#f3f4f6", borderRadius:99 }}>
                <div style={{ height:"100%", width:`${p.accuracy}%`, background:p.accuracy>=95?"#22c55e":"#f97316", borderRadius:99 }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ background:"#fff", borderRadius:12, padding:"1.25rem", boxShadow:"0 1px 3px rgba(0,0,0,0.07)" }}>
          <p style={{ fontWeight:700, fontSize:"0.9rem", marginBottom:"0.25rem" }}>Generate AI Forecast</p>
          <p style={{ fontSize:"0.7rem", color:"#9ca3af", marginBottom:"1rem" }}>Estimate materials for a new project by type &amp; budget</p>
          <div style={{ display:"flex", flexDirection:"column", gap:"0.625rem", marginBottom:"0.875rem" }}>
            <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Project Type</p><select value={genType} onChange={e=>{setGenType(e.target.value);setGenResult(null);}} style={sel}>{["Infrastructure","Commercial","Residential","Industrial","Renovation"].map(t=><option key={t}>{t}</option>)}</select></div>
            <div><p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:4 }}>Total Budget (₱)</p><input value={genBudget} onChange={e=>{setGenBudget(e.target.value);setGenResult(null);}} type="number" style={{ background:"#111827",color:"#fff",border:"none",borderRadius:8,padding:"9px 12px",fontSize:"0.875rem",outline:"none",width:"100%",boxSizing:"border-box" as const }} suppressHydrationWarning /></div>
          </div>
          <button onClick={()=>{ if(!genBudget||isNaN(Number(genBudget))){toast.error("Enter a valid budget.");return;} setGenResult(generateAIForecast(mock,repo)); toast.success("Forecast generated!"); }} style={{ width:"100%",padding:"10px",borderRadius:8,border:"none",background:"#f97316",color:"#fff",fontWeight:700,fontSize:"0.875rem",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
            <Brain style={{ width:14,height:14 }} /> Run AI Forecast
          </button>
          {genResult && (
            <div style={{ marginTop:"0.875rem", background:"#f9fafb", borderRadius:10, padding:"0.875rem" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"0.5rem" }}>
                <span style={{ fontSize:"0.78rem", fontWeight:700 }}>Forecast Result</span>
                <span style={{ fontSize:"0.72rem", fontWeight:700, color:"#22c55e" }}>{genResult.confidence}% confidence</span>
              </div>
              <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginBottom:"0.5rem" }}>Est. materials cost: <strong style={{ color:"#f97316" }}>₱{(totalEst/1_000_000).toFixed(2)}M</strong></p>
              {genResult.phases.slice(0,3).map(ph=>(
                <div key={ph.name} style={{ padding:"0.4rem 0", borderBottom:"1px solid #e5e7eb" }}>
                  <p style={{ fontSize:"0.72rem", fontWeight:600, color:"#374151", marginBottom:2 }}>{ph.name}</p>
                  {ph.materials.slice(0,2).map(m=>(
                    <div key={m.material} style={{ display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontSize:"0.68rem", color:"#9ca3af" }}>{m.material}</span>
                      <span style={{ fontSize:"0.68rem", fontWeight:600 }}>{m.qty.toLocaleString()} {m.unit}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Project Card ──────────────────────────────────────────────────────────────

function ProjectCard({ project, onMaterialPlan, onMeasurements, onReports, onAIForecast, onEdit }: {
  project: Project; onMaterialPlan:()=>void; onMeasurements:()=>void; onReports:()=>void; onAIForecast:()=>void; onEdit:()=>void;
}) {
  const st = STATUS_STYLE[project.status];
  const btn: React.CSSProperties = { flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:5, padding:"7px 0", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.7rem", fontWeight:600, cursor:"pointer" };
  return (
    <div style={{ background:"#fff", borderRadius:14, padding:"1.25rem", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"0.5rem" }}>
        <p style={{ fontWeight:700, fontSize:"1rem", color:"#2563eb" }}>{project.name}</p>
        <div style={{ display:"flex", gap:5, alignItems:"center", flexShrink:0 }}>
          <span style={{ fontSize:"0.62rem", fontWeight:700, padding:"3px 9px", borderRadius:999, background:st.bg, color:st.color }}>· {project.status}</span>
          <button onClick={onEdit} style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 10px", borderRadius:6, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.68rem", fontWeight:600, cursor:"pointer" }}>
            <Pencil style={{ width:11, height:11 }} /> Edit
          </button>
        </div>
      </div>
      <div style={{ display:"flex", gap:14, marginBottom:"0.875rem" }}>
        <span style={{ fontSize:"0.72rem", color:"#9ca3af", display:"flex", alignItems:"center", gap:3 }}><MapPin style={{ width:11,height:11 }} />{project.location}</span>
        <span style={{ fontSize:"0.72rem", color:"#9ca3af", display:"flex", alignItems:"center", gap:3 }}><Calendar style={{ width:11,height:11 }} />{project.startDate} – {project.endDate}</span>
      </div>
      <div style={{ marginBottom:"0.875rem" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
          <span style={{ fontSize:"0.7rem", color:"#9ca3af" }}>Progress</span>
          <span style={{ fontSize:"0.72rem", fontWeight:700, color:project.progressColor }}>{project.progress}%</span>
        </div>
        <div style={{ height:8, background:"#e5e7eb", borderRadius:99 }}>
          <div style={{ height:"100%", width:`${project.progress}%`, background:project.progressColor, borderRadius:99 }} />
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.5rem", marginBottom:"0.75rem" }}>
        {[["Budget",project.budget],["Spent",project.spent],["Materials",`${project.materials} items`]].map(([l,v])=>(
          <div key={l} style={{ background:"#f9fafb", borderRadius:8, padding:"0.5rem 0.75rem" }}>
            <p style={{ fontSize:"0.6rem", color:"#9ca3af" }}>{l}</p>
            <p style={{ fontWeight:700, fontSize:"0.85rem", color:"#111827" }}>{v}</p>
          </div>
        ))}
      </div>
      {project.bom.length > 0 && (
        <div style={{ background:"#fff7ed", borderRadius:8, padding:"0.5rem 0.75rem", marginBottom:"0.75rem", display:"flex", alignItems:"center", gap:6 }}>
          <Package style={{ width:12, height:12, color:"#f97316" }} />
          <span style={{ fontSize:"0.7rem", color:"#c2410c", fontWeight:500 }}>BOM: {project.bom.length} materials · ₱{project.bom.reduce((s,b)=>s+b.qty*b.unitCost,0).toLocaleString()}</span>
        </div>
      )}
      <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:"0.875rem" }}>
        <Users style={{ width:11, height:11, color:"#9ca3af" }} />
        <span style={{ fontSize:"0.7rem", color:"#6b7280" }}>{project.manager}{project.engineers.length>0&&` · ${project.engineers.join(", ")}`}</span>
      </div>
      <div style={{ display:"flex", gap:"0.375rem" }}>
        <button onClick={onMaterialPlan} style={btn}><FileText style={{ width:11,height:11 }} /> Material Plan</button>
        <button onClick={onMeasurements} style={btn}><Ruler style={{ width:11,height:11 }} /> Measure</button>
        <button onClick={onReports} style={btn}><BarChart3 style={{ width:11,height:11 }} /> Reports</button>
        <button onClick={onAIForecast} style={{ ...btn, background:"#f97316" }}><Brain style={{ width:11,height:11 }} /> AI Forecast</button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type PageTab = "active" | "finished" | "forecasting";
type ModalState =
  | { type:"choice" }
  | { type:"new" }
  | { type:"addFinished" }
  | { type:"materialPlan"; project: Project; extraRows?: BOMRow[] }
  | { type:"measurements"; project: Project }
  | { type:"reports"; project: Project }
  | { type:"forecast"; project: Project }
  | { type:"aiForecast"; project: Project }
  | { type:"edit"; project: Project }
  | null;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>(INIT_PROJECTS);
  const [finRepo,  setFinRepo]  = useState<FinishedProject[]>(INIT_FINISHED);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState<ModalState>(null);
  const [pageTab,  setPageTab]  = useState<PageTab>("active");

  useEffect(() => {
    api.get<ProjectResponseDto[]>("/projects")
      .then(r => setProjects(r.data.map(toProject)))
      .catch(() => toast.error("Failed to load projects."))
      .finally(() => setLoading(false));
  }, []);

  const activeProjects = projects.filter(p => p.status !== "COMPLETED");

  function handleCreate(p: Project) { setProjects(prev => [...prev, p]); }

  function handleSaveBOM(project: Project, bom: BOMRow[]) {
    setProjects(prev => prev.map(p => p.id===project.id ? { ...p, bom, forecastReady:bom.length>0, materials:bom.filter(b=>b.material.trim()).length } : p));
    toast.success("BOM saved!");
  }

  function handleRunForecast(project: Project, bom: BOMRow[]) {
    setProjects(prev => prev.map(p => p.id===project.id ? { ...p, bom, forecastReady:true } : p));
    setModal({ type:"forecast", project: { ...project, bom } });
  }

  function handleAddToPlan(project: Project, extraRows: BOMRow[]) {
    setModal({ type:"materialPlan", project, extraRows });
  }

  function handleEditSave(project: Project, updates: Partial<Project>) {
    setProjects(prev => prev.map(p => p.id===project.id ? { ...p, ...updates } : p));
  }

  const proj = modal && "project" in modal ? modal.project : undefined;

  const TABS = [
    { id:"active"      as PageTab, label:"Active Projects",     count: activeProjects.length },
    { id:"finished"    as PageTab, label:"Finished Repository", count: finRepo.length },
    { id:"forecasting" as PageTab, label:"Forecasting" },
  ];

  return (
    <div style={{ background:"#f5f4f0" }}>
      {modal?.type==="choice"       && <ChoiceModal onNew={()=>setModal({type:"new"})} onFinished={()=>setModal({type:"addFinished"})} onClose={()=>setModal(null)} />}
      {modal?.type==="new"          && <NewProjectModal onClose={()=>setModal(null)} onCreate={handleCreate} />}
      {modal?.type==="addFinished"  && <AddFinishedModal onClose={()=>setModal(null)} onAdd={fp=>setFinRepo(r=>[...r,fp])} />}
      {modal?.type==="edit"         && proj && <EditProjectModal project={proj} onClose={()=>setModal(null)} onSave={updates=>handleEditSave(proj,updates)} />}
      {modal?.type==="materialPlan" && proj && (
        <MaterialPlanModal
          project={proj}
          extraRows={modal.type==="materialPlan" ? modal.extraRows : undefined}
          onClose={()=>setModal(null)}
          onSaveBOM={bom=>handleSaveBOM(proj,bom)}
          onRunForecast={bom=>handleRunForecast(proj,bom)}
        />
      )}
      {modal?.type==="measurements" && proj && <MeasurementsModal project={proj} onClose={()=>setModal(null)} onAddToPlan={rows=>handleAddToPlan(proj,rows)} />}
      {modal?.type==="reports"      && proj && <ReportsModal      project={proj} onClose={()=>setModal(null)} />}
      {modal?.type==="forecast"     && proj && <ForecastModal     project={proj} onClose={()=>setModal(null)} />}
      {modal?.type==="aiForecast"   && proj && <AIForecastModal   project={proj} repo={finRepo} onClose={()=>setModal(null)} />}

      <Header title="Projects" />

      <div style={{ padding:"1.25rem 1.5rem" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem" }}>
          <div>
            <p style={{ fontWeight:800, fontSize:"1.4rem", color:"#111827" }}>Projects</p>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>
              {loading?"Loading…":`${projects.length} total · ${activeProjects.filter(p=>p.status==="ACTIVE").length} active · ${finRepo.length} in repository`}
            </p>
          </div>
          <button onClick={()=>setModal({type:"choice"})} style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 20px", borderRadius:10, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>
            <Plus style={{ width:15, height:15 }} /> New Project
          </button>
        </div>

        <div style={{ display:"flex", gap:4, background:"#e5e7eb", borderRadius:8, padding:4, width:"fit-content", marginBottom:"1.25rem" }}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setPageTab(t.id)} style={{ padding:"6px 18px", borderRadius:6, fontSize:"0.875rem", fontWeight:pageTab===t.id?600:400, border:"none", cursor:"pointer", background:pageTab===t.id?"#fff":"transparent", color:pageTab===t.id?"#111827":"#6b7280", boxShadow:pageTab===t.id?"0 1px 3px rgba(0,0,0,0.1)":"none", transition:"all 0.15s" }}>
              {t.label}{"count" in t && t.count !== undefined && <span style={{ marginLeft:5, fontSize:"0.62rem", background:pageTab===t.id?"#f97316":"#9ca3af", color:"#fff", borderRadius:999, padding:"1px 6px" }}>{t.count}</span>}
            </button>
          ))}
        </div>

        {pageTab==="active" && (
          loading ? (
            <div style={{ padding:"3rem", textAlign:"center", color:"#9ca3af" }}>Loading projects…</div>
          ) : activeProjects.length===0 ? (
            <div style={{ padding:"3rem", textAlign:"center", color:"#9ca3af" }}>No active projects. Click &ldquo;New Project&rdquo; to get started.</div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem" }}>
              {activeProjects.map(p=>(
                <ProjectCard key={p.id} project={p}
                  onMaterialPlan={()=>setModal({type:"materialPlan",project:p})}
                  onMeasurements={()=>setModal({type:"measurements",project:p})}
                  onReports={    ()=>setModal({type:"reports",      project:p})}
                  onAIForecast={ ()=>setModal({type:"aiForecast",   project:p})}
                  onEdit={       ()=>setModal({type:"edit",         project:p})}
                />
              ))}
            </div>
          )
        )}

        {pageTab==="finished" && (
          <div style={{ display:"flex", flexDirection:"column", gap:"0.875rem" }}>
            <div style={{ background:"#eef2ff", border:"1px solid #c7d2fe", borderRadius:10, padding:"0.75rem 1.25rem", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <Archive style={{ width:15, height:15, color:"#6366f1" }} />
                <p style={{ fontSize:"0.82rem", color:"#3730a3", fontWeight:600 }}>{finRepo.length} completed projects — AI forecasting reference</p>
              </div>
              <button onClick={()=>setModal({type:"addFinished"})} style={{ padding:"5px 12px", borderRadius:7, border:"1px solid #6366f1", background:"#fff", color:"#6366f1", fontSize:"0.78rem", fontWeight:600, cursor:"pointer" }}>+ Add Project</button>
            </div>
            {finRepo.map(fp=><FinishedProjectCard key={fp.id} fp={fp} />)}
          </div>
        )}

        {pageTab==="forecasting" && <ForecastingTab repo={finRepo} />}
      </div>
    </div>
  );
}
