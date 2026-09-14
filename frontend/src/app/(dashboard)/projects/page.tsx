"use client";

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import api from "@/lib/api";
import Header from "@/components/layout/Header";
import { useAuthStore } from "@/store/authStore";
import {
  Plus, MapPin, Calendar, Users, FileText, X, Pencil,
  ShoppingCart, Package, Upload, FolderOpen, ChevronDown,
  ChevronUp, Trash2, Search, Tag, BarChart3, Camera, Activity,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

type ProjectStatus = "ACTIVE" | "PLANNING" | "COMPLETED" | "ON HOLD";

interface Project {
  id: number; name: string; location: string;
  startDate: string; endDate: string; status: ProjectStatus;
  progress: number; progressColor: string;
  budget: string; spent: string; materials: number;
  manager: string; engineers: string[];
  type: string;
}

interface InventoryItem {
  id: number; name: string; spec: string; unit: string;
  category: string; stock: number; price: number;
}

interface BOMItem {
  inventoryId: number; name: string; spec: string; unit: string;
  estQty: number; stock: number; price: number; category: string;
}

interface ProjectPhase {
  id: number; name: string;
  dims: { length: number; width: number; height: number; thickness: number };
  items: BOMItem[];
}

interface RepoFile {
  id: number; name: string;
  category: "Blueprint / Drawing" | "Contract / Agreement" | "Other Record";
  status: "Final" | "Draft"; revision: string;
  docType: string; project: string; author: string;
  date: string; size: string; description: string; tags: string[];
}

// ── Static Data ────────────────────────────────────────────────────────────────

const INIT_PROJECTS: Project[] = [
  { id:1, name:"Metro Station Phase 3",   location:"EDSA, QC",     startDate:"2024-08-01", endDate:"2026-03-31", status:"ACTIVE",    progress:62,  progressColor:"#f97316", budget:"₱45.0M",  spent:"₱27.9M", materials:8,  manager:"Remy Santos",  engineers:["Carlos Reyes","Maria Tan"],   type:"Infrastructure" },
  { id:2, name:"BGC Tower Complex",        location:"BGC, Taguig",  startDate:"2025-01-15", endDate:"2027-06-30", status:"ACTIVE",    progress:38,  progressColor:"#1e3154", budget:"₱120.0M", spent:"₱45.6M", materials:12, manager:"Remy Santos",  engineers:["Jose Lim"],                  type:"Commercial" },
  { id:3, name:"Harbor Bridge Renovation", location:"Manila Harbor", startDate:"2024-03-01", endDate:"2025-12-31", status:"ACTIVE",    progress:81,  progressColor:"#22c55e", budget:"₱28.0M",  spent:"₱22.7M", materials:6,  manager:"Remy Santos",  engineers:["Carlos Reyes"],              type:"Infrastructure" },
  { id:4, name:"Southgate Mall Expansion", location:"BGC, Taguig",  startDate:"2025-06-01", endDate:"2027-09-30", status:"PLANNING",  progress:12,  progressColor:"#374151", budget:"₱75.0M",  spent:"₱9.0M",  materials:4,  manager:"Remy Santos",  engineers:["Ana Cruz","Ben Torres"],     type:"Commercial" },
  { id:5, name:"PUP ICTC Building",        location:"Sta. Mesa",    startDate:"2023-01-10", endDate:"2025-01-15", status:"COMPLETED", progress:100, progressColor:"#22c55e", budget:"₱19.3M",  spent:"₱19.1M", materials:9,  manager:"Remy Santos",  engineers:["Ana Cruz"],                  type:"Infrastructure" },
];

const INVENTORY_ITEMS: InventoryItem[] = [
  { id:1,  name:"Portland Cement",           spec:"40kg/bag, Type I",        unit:"bags",   category:"Masonry",     stock:1240, price:285  },
  { id:2,  name:"Gravel 3/4",                spec:"Washed fine aggregate",    unit:"m³",     category:"Aggregates",  stock:850,  price:1450 },
  { id:3,  name:"Coarse Gravel",             spec:'3/4" crushed stone',       unit:"m³",     category:"Aggregates",  stock:420,  price:1450 },
  { id:4,  name:"Deformed Steel Bar (16mm)", spec:"16mm Ø × 6m",             unit:"pcs",    category:"Metals",      stock:280,  price:580  },
  { id:5,  name:"Ready-mix Concrete",        spec:"4000 PSI (28 MPa)",        unit:"m³",     category:"Masonry",     stock:0,    price:5800 },
  { id:6,  name:"CHB 4-inch",               spec:"Standard hollow block",    unit:"pcs",    category:"Masonry",     stock:3200, price:14   },
  { id:7,  name:"PVC Pipe 4-inch",          spec:'S-1000 pressure rated',    unit:"length", category:"Mechanical",  stock:180,  price:450  },
  { id:8,  name:"Electrical Conduit",        spec:'EMT 3/4" × 3m',           unit:"length", category:"Electrical",  stock:640,  price:180  },
  { id:9,  name:"Ceramic Floor Tiles (60×60)", spec:"Polished, glazed",       unit:"sqm",    category:"Paintings",   stock:420,  price:450  },
  { id:10, name:"Insulated Copper Wire",     spec:"3.5mm², THHN",             unit:"m",      category:"Electrical",  stock:1860, price:42   },
  { id:11, name:"Galvanized Iron Pipe (1\")", spec:"Sch. 40, 6m length",      unit:"length", category:"Mechanical",  stock:540,  price:864  },
  { id:12, name:"Interior Paint (White)",   spec:"Latex, 4L/can",            unit:"can",    category:"Paintings",   stock:230,  price:520  },
  { id:13, name:"Fine Sand",                spec:"Washed fine aggregate",    unit:"m³",     category:"Aggregates",  stock:850,  price:900  },
  { id:14, name:"Plywood 3/4",             spec:"Marine ply, 4×8ft",        unit:"sheet",  category:"Carpentry",   stock:120,  price:1200 },
  { id:15, name:"Steel Angle Bar",          spec:"2×2×3/16, 6m",            unit:"pcs",    category:"Metals",      stock:86,   price:890  },
];

const INV_CATEGORIES = ["All","Masonry","Metals","Carpentry","Mechanical","Electrical","Paintings","Aggregates"];

const INIT_REPO: RepoFile[] = [
  { id:1, name:"Architectural Floor Plan - Building A", category:"Blueprint / Drawing", status:"Final", revision:"Rev. 3", docType:"Floor Plan", project:"Skyline Tower Residential Complex", author:"Arch. Jose Reyes", date:"2025-11-10", size:"4.2 MB", description:"Main floor plan for Building A ground floor.", tags:["floor plan","building A"] },
  { id:2, name:"General Construction Contract", category:"Contract / Agreement",  status:"Final", revision:"",     docType:"General Contract", project:"Metro Rail Transit Extension", author:"Legal Dept.", date:"2025-09-01", size:"1.1 MB", description:"Main contract between owner and contractor.", tags:["contract","MRT"] },
  { id:3, name:"Soil Test Report - Phase 1", category:"Other Record", status:"Final", revision:"",  docType:"Soil Test Report", project:"Harbor Bridge Rehabilitation", author:"Geo Solutions Inc.", date:"2025-08-20", size:"850 KB", description:"Geotechnical investigation results.", tags:["soil","geotech"] },
];

const PHASE_NAMES = ["Foundation","Structural Framing","Finishing","MEP"];

function defaultPhases(): ProjectPhase[] {
  return PHASE_NAMES.map((name, i) => ({
    id: i + 1, name,
    dims: { length: 0, width: 0, height: 0, thickness: 0.20 },
    items: [],
  }));
}

// ── API ────────────────────────────────────────────────────────────────────────

interface ProjectResponseDto {
  id: number; name: string; type: string; location: string;
  description?: string; budget: number; startDate: string;
  targetEndDate: string; status: string;
  projectManagerName: string; siteEngineerName?: string;
  phases: unknown[];
}

const STATUS_MAP: Record<string, ProjectStatus> = {
  Planning:"PLANNING", Active:"ACTIVE", OnHold:"ON HOLD",
  Completed:"COMPLETED", Cancelled:"COMPLETED",
};
const PROGRESS_COLOR: Record<string, string> = {
  PLANNING:"#374151", ACTIVE:"#f97316", COMPLETED:"#22c55e", "ON HOLD":"#d97706",
};

function toProject(dto: ProjectResponseDto): Project {
  const status = (STATUS_MAP[dto.status] ?? "PLANNING") as ProjectStatus;
  const demo = INIT_PROJECTS.find(p => p.name === dto.name);
  return {
    id: dto.id, name: dto.name, location: dto.location, type: dto.type,
    startDate: dto.startDate.split("T")[0], endDate: dto.targetEndDate.split("T")[0],
    status, progress: demo?.progress ?? (status==="COMPLETED"?100:status==="ACTIVE"?50:10),
    progressColor: demo?.progressColor ?? PROGRESS_COLOR[status] ?? "#374151",
    budget: `₱${Number(dto.budget).toLocaleString()}`, spent: demo?.spent ?? "₱0",
    materials: demo?.materials ?? 0,
    manager: demo?.manager ?? dto.projectManagerName,
    engineers: demo?.engineers ?? (dto.siteEngineerName ? [dto.siteEngineerName] : []),
  };
}

const STATUS_STYLE: Record<ProjectStatus, { bg: string; color: string }> = {
  ACTIVE:    { bg:"#dcfce7", color:"#15803d" },
  PLANNING:  { bg:"#ffedd5", color:"#c2410c" },
  COMPLETED: { bg:"#f3f4f6", color:"#374151" },
  "ON HOLD": { bg:"#fef3c7", color:"#b45309" },
};

// ── Shared input style ─────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width:"100%", boxSizing:"border-box" as const, padding:"9px 12px",
  border:"1px solid #e5e7eb", borderRadius:8, fontSize:"0.85rem",
  outline:"none", background:"#fff", color:"#111827",
};

// ── Overlay ────────────────────────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:"1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ maxHeight:"90vh", overflowY:"auto" }}>
        {children}
      </div>
    </div>
  );
}

// ── New Project Modal ─────────────────────────────────────────────────────────

const MANAGERS = ["Remy Santos","Ana Bonifacio","Carlos Reyes","Jose Lim","Ben Torres"];
const ENGINEERS = ["Carlo Reyes","Maria Tan","Ana Cruz","Jose Lim","Ben Torres","Carlos Reyes"];

function NewProjectModal({ onClose, onCreate }: { onClose:()=>void; onCreate:(p:Project)=>void }) {
  const [name,    setName]    = useState("");
  const [type,    setType]    = useState("Renovation");
  const [loc,     setLoc]     = useState("");
  const [budget,  setBudget]  = useState("1500000.00");
  const [start,   setStart]   = useState("2026-05-05");
  const [end,     setEnd]     = useState("2026-08-06");
  const [mgr,     setMgr]     = useState(MANAGERS[0]);
  const [eng,     setEng]     = useState(ENGINEERS[0]);
  const [cont,    setCont]    = useState("");
  const [desc,    setDesc]    = useState("");
  const [saving,  setSaving]  = useState(false);

  const sel: React.CSSProperties = { ...inp, cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"] };

  async function handleCreate() {
    if (!name.trim() || !loc.trim()) { toast.error("Name and location are required."); return; }
    setSaving(true);
    try {
      const { data } = await api.post<ProjectResponseDto>("/projects", {
        name:name.trim(), type, location:loc.trim(), description:desc||null,
        budget:parseFloat(budget)||0, startDate:new Date(start).toISOString(),
        targetEndDate:new Date(end).toISOString(), assignedContractor:cont||null,
        siteEngineerId:null, phases:[],
      });
      toast.success(`"${data.name}" created!`); onCreate(toProject(data)); onClose();
    } catch { toast.error("Failed to create project."); }
    finally  { setSaving(false); }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"2rem", width:480, boxShadow:"0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.5rem" }}>
          <p style={{ fontWeight:800, fontSize:"1.15rem", color:"#111827" }}>New Project</p>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem" }}>
          <div><label style={lbl}>Project Name</label><input value={name} onChange={e=>setName(e.target.value)} style={inp} placeholder="ICTC Hall" suppressHydrationWarning /></div>
          <div><label style={lbl}>Project Type</label><select value={type} onChange={e=>setType(e.target.value)} style={sel}>{["Renovation","Commercial","Industrial","Infrastructure","Residential"].map(t=><option key={t}>{t}</option>)}</select></div>
          <div><label style={lbl}>Location</label><input value={loc} onChange={e=>setLoc(e.target.value)} style={inp} placeholder="BGC Taguig" suppressHydrationWarning /></div>
          <div><label style={lbl}>Budget (₱)</label><input value={budget} onChange={e=>setBudget(e.target.value)} style={inp} placeholder="1,500,000.00" suppressHydrationWarning /></div>
          <div><label style={lbl}>Start Date</label><input type="date" value={start} onChange={e=>setStart(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><label style={lbl}>End Date</label><input type="date" value={end} onChange={e=>setEnd(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><label style={lbl}>Project Manager</label><select value={mgr} onChange={e=>setMgr(e.target.value)} style={sel}>{MANAGERS.map(m=><option key={m}>{m}</option>)}</select></div>
          <div><label style={lbl}>PIC/Site Engineer</label><select value={eng} onChange={e=>setEng(e.target.value)} style={sel}>{ENGINEERS.map(m=><option key={m}>{m}</option>)}</select></div>
          <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Contractor</label><input value={cont} onChange={e=>setCont(e.target.value)} style={inp} placeholder="Discaya" suppressHydrationWarning /></div>
          <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Project Description</label><textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={3} style={{ ...inp, resize:"vertical" as React.CSSProperties["resize"] }} placeholder="Renovation" suppressHydrationWarning /></div>
        </div>
        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end", marginTop:"1.5rem" }}>
          <button onClick={onClose} style={{ padding:"10px 24px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleCreate} disabled={saving} style={{ padding:"10px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer", opacity:saving?0.7:1 }}>{saving?"Creating…":"Create Project"}</button>
        </div>
      </div>
    </Overlay>
  );
}

const lbl: React.CSSProperties = { display:"block", fontSize:"0.72rem", color:"#6b7280", fontWeight:500, marginBottom:4 };

// ── Edit Project Details Modal (pencil button) ────────────────────────────────

type EditTab = "materialPlan" | "measurements";
type StructType = "Floor Slab" | "Wall" | "Column" | "Beam" | "Footing";

function EditProjectDetailsModal({ project, onClose }: { project:Project; onClose:()=>void }) {
  const [tab,        setTab]      = useState<EditTab>("materialPlan");
  const [phases,     setPhases]   = useState<ProjectPhase[]>(defaultPhases);
  const [activePhase,setActivePhase] = useState(0);
  const [invCat,     setInvCat]   = useState("All");
  const [phase,      setPhase]    = useState("Foundation");
  const [duration,   setDuration] = useState("30 days");

  // Measurements
  const [structType, setStructType] = useState<StructType>("Floor Slab");
  const [subType,    setSubType]    = useState<"Wall"|"Column"|"Beam"|"Slab">("Wall");
  const dims = phases[activePhase]?.dims ?? { length:0, width:0, height:0, thickness:0.20 };

  function setDim(field: keyof ProjectPhase["dims"], val: string) {
    setPhases(prev => prev.map((ph, i) => i === activePhase
      ? { ...ph, dims: { ...ph.dims, [field]: parseFloat(val) || 0 } }
      : ph
    ));
  }

  const vol = structType === "Wall"
    ? dims.length * dims.height * dims.thickness
    : dims.length * dims.width * dims.thickness;
  const area = structType === "Wall"
    ? dims.length * dims.height
    : dims.length * dims.width;

  function addItem(inv: InventoryItem) {
    setPhases(prev => prev.map((ph, i) => {
      if (i !== activePhase) return ph;
      if (ph.items.find(it => it.inventoryId === inv.id)) return ph;
      return { ...ph, items: [...ph.items, { inventoryId:inv.id, name:inv.name, spec:inv.spec, unit:inv.unit, estQty:0, stock:inv.stock, price:inv.price, category:inv.category }] };
    }));
  }

  function removeItem(inventoryId: number) {
    setPhases(prev => prev.map((ph, i) => i === activePhase
      ? { ...ph, items: ph.items.filter(it => it.inventoryId !== inventoryId) }
      : ph
    ));
  }

  function setItemQty(inventoryId: number, val: string) {
    setPhases(prev => prev.map((ph, i) => i === activePhase
      ? { ...ph, items: ph.items.map(it => it.inventoryId === inventoryId ? { ...it, estQty: parseFloat(val) || 0 } : it) }
      : ph
    ));
  }

  const filtered = invCat === "All" ? INVENTORY_ITEMS : INVENTORY_ITEMS.filter(i => i.category === invCat);
  const currentItems = phases[activePhase]?.items ?? [];
  const totalCost = currentItems.reduce((s, it) => s + it.estQty * it.price, 0);
  const sel: React.CSSProperties = { ...inp, cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"] };

  const tabBtn = (t: EditTab, label: string) => (
    <button onClick={()=>setTab(t)} style={{ display:"flex", alignItems:"center", gap:6, padding:"9px 18px", borderRadius:8, border:"none", cursor:"pointer", background:tab===t?"#111827":"#f3f4f6", color:tab===t?"#fff":"#6b7280", fontWeight:tab===t?600:400, fontSize:"0.85rem" }}>
      {t==="materialPlan" ? <FileText style={{ width:14, height:14 }} /> : <Pencil style={{ width:14, height:14 }} />}
      {label}
    </button>
  );

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:520, boxShadow:"0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1rem" }}>
          <div>
            <p style={{ fontWeight:800, fontSize:"1.1rem", color:"#111827" }}>Edit Project Details</p>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>{project.name}</p>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:6, marginBottom:"1.25rem" }}>
          {tabBtn("materialPlan","Material Plan")}
          {tabBtn("measurements","Measurements")}
        </div>

        {tab === "materialPlan" && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem", marginBottom:"1rem" }}>
              <div><label style={lbl}>Phase</label><select value={phase} onChange={e=>setPhase(e.target.value)} style={sel}>{PHASE_NAMES.map(n=><option key={n}>{n}</option>)}</select></div>
              <div><label style={lbl}>Phase Duration</label><select value={duration} onChange={e=>setDuration(e.target.value)} style={sel}>{["30 days","60 days","90 days","120 days"].map(d=><option key={d}>{d}</option>)}</select></div>
            </div>

            <div style={{ border:"1px solid #e5e7eb", borderRadius:10, padding:"1rem", marginBottom:"1rem" }}>
              <p style={{ fontWeight:700, fontSize:"0.875rem", marginBottom:"0.75rem" }}>Select from Inventory</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:"0.75rem" }}>
                {INV_CATEGORIES.map(c=>(
                  <button key={c} onClick={()=>setInvCat(c)} style={{ padding:"4px 12px", borderRadius:999, border:"none", cursor:"pointer", fontSize:"0.75rem", fontWeight:invCat===c?700:400, background:invCat===c?"#111827":"#f3f4f6", color:invCat===c?"#fff":"#374151" }}>{c}</button>
                ))}
              </div>
              <div style={{ maxHeight:160, overflowY:"auto" }}>
                {filtered.map(inv=>(
                  <div key={inv.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 4px", borderBottom:"1px solid #f9fafb" }}>
                    <div>
                      <p style={{ fontSize:"0.82rem", fontWeight:500, color:"#111827" }}>{inv.name}</p>
                      <p style={{ fontSize:"0.68rem", color:"#9ca3af" }}>{inv.category} · Stock: {inv.stock.toLocaleString()} · ₱{inv.price.toLocaleString()}</p>
                    </div>
                    <button onClick={()=>addItem(inv)} style={{ width:26, height:26, borderRadius:"50%", border:"none", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#f97316", fontSize:"1.1rem", fontWeight:700 }}>+</button>
                  </div>
                ))}
              </div>
            </div>

            {currentItems.length > 0 && (
              <div style={{ border:"1px solid #e5e7eb", borderRadius:10, padding:"1rem", marginBottom:"1rem" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"0.75rem" }}>
                  <p style={{ fontWeight:700, fontSize:"0.875rem" }}>Selected Materials</p>
                  <button onClick={()=>toast.success("Procurement team notified!")} style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 12px", borderRadius:8, border:"1px solid #f97316", background:"#fff7ed", color:"#f97316", fontSize:"0.72rem", fontWeight:600, cursor:"pointer" }}>
                    🔔 Notify Procurement
                  </button>
                </div>
                {currentItems.map(it=>(
                  <div key={it.inventoryId} style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto", gap:8, alignItems:"center", marginBottom:6 }}>
                    <div>
                      <p style={{ fontSize:"0.8rem", fontWeight:500 }}>{it.name}</p>
                      <p style={{ fontSize:"0.65rem", color:"#9ca3af" }}>{it.category}</p>
                    </div>
                    <input value={it.estQty||""} onChange={e=>setItemQty(it.inventoryId,e.target.value)} type="number" placeholder="Qty" style={{ ...inp, width:70, padding:"5px 8px" }} suppressHydrationWarning />
                    <span style={{ fontSize:"0.72rem", color:"#22c55e", whiteSpace:"nowrap" }}>Available: {it.stock.toLocaleString()}</span>
                    <button onClick={()=>removeItem(it.inventoryId)} style={{ background:"none", border:"none", cursor:"pointer", color:"#ef4444", padding:0 }}><X style={{ width:15, height:15 }} /></button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <p style={{ fontSize:"0.78rem", color:"#9ca3af" }}>Total Materials: {currentItems.length} · Total Cost: <strong style={{ color:"#111827" }}>₱{totalCost.toLocaleString()}</strong></p>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={onClose} style={{ padding:"9px 18px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.82rem", cursor:"pointer" }}>Cancel</button>
                <button onClick={()=>{ toast.success("Material plan saved!"); onClose(); }} style={{ padding:"9px 18px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.82rem", fontWeight:700, cursor:"pointer" }}>Save Material Plan</button>
              </div>
            </div>
          </>
        )}

        {tab === "measurements" && (
          <>
            {/* Primary structure type */}
            <div style={{ display:"flex", gap:6, marginBottom:"0.875rem", flexWrap:"wrap" }}>
              {(["Floor Slab","Wall","Column","Beam","Footing"] as StructType[]).map(t=>(
                <button key={t} onClick={()=>setStructType(t)} style={{ padding:"7px 16px", borderRadius:999, border:"none", cursor:"pointer", fontSize:"0.82rem", fontWeight:structType===t?700:400, background:structType===t?"#f97316":"#f3f4f6", color:structType===t?"#fff":"#374151" }}>{t}</button>
              ))}
            </div>

            {/* Sub-type */}
            <div style={{ marginBottom:"1rem" }}>
              <p style={{ fontSize:"0.75rem", color:"#9ca3af", marginBottom:"0.5rem" }}>Structure Type</p>
              <div style={{ display:"flex", gap:6 }}>
                {(["Wall","Column","Beam","Slab"] as const).map(t=>(
                  <button key={t} onClick={()=>setSubType(t)} style={{ padding:"6px 14px", borderRadius:999, border:"none", cursor:"pointer", fontSize:"0.82rem", fontWeight:subType===t?700:400, background:subType===t?"#f97316":"#f3f4f6", color:subType===t?"#fff":"#374151" }}>{t}</button>
                ))}
              </div>
            </div>

            {/* Dimensions */}
            <div style={{ border:"1px solid #e5e7eb", borderRadius:10, padding:"1rem", marginBottom:"1rem" }}>
              <p style={{ fontWeight:700, fontSize:"0.875rem", marginBottom:"0.75rem" }}>Enter Dimensions (meters)</p>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
                <div><label style={lbl}>Length</label><input value={dims.length||""} onChange={e=>setDim("length",e.target.value)} type="number" style={inp} placeholder="1450" suppressHydrationWarning /></div>
                <div><label style={lbl}>Width</label><input value={dims.width||""} onChange={e=>setDim("width",e.target.value)} type="number" style={inp} placeholder="1840" suppressHydrationWarning /></div>
                <div><label style={lbl}>Height</label><input value={dims.height||""} onChange={e=>setDim("height",e.target.value)} type="number" style={inp} placeholder="150" suppressHydrationWarning /></div>
                <div><label style={lbl}>Thickness</label><input value={dims.thickness||""} onChange={e=>setDim("thickness",e.target.value)} type="number" style={inp} placeholder="100" suppressHydrationWarning /></div>
              </div>
            </div>

            {/* Calculated results */}
            {(vol > 0 || area > 0) && (
              <div style={{ border:"1px solid #e5e7eb", borderRadius:10, padding:"1rem", marginBottom:"1rem", background:"#f9fafb" }}>
                <p style={{ fontWeight:700, fontSize:"0.875rem", marginBottom:"0.75rem" }}>Calculated Results</p>
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontSize:"0.82rem", color:"#6b7280" }}>Volume:</span>
                  <span style={{ fontSize:"0.82rem", fontWeight:600 }}>{vol.toFixed(5)} m³</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontSize:"0.82rem", color:"#6b7280" }}>Surface Area:</span>
                  <span style={{ fontSize:"0.82rem", fontWeight:600 }}>{area.toFixed(3)} m²</span>
                </div>
              </div>
            )}

            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={onClose} style={{ padding:"9px 18px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.82rem", cursor:"pointer" }}>Cancel</button>
              <button onClick={()=>{ if(vol===0){toast.error("Enter dimensions first."); return;} toast.success("Material requirements calculated!"); }} style={{ padding:"9px 18px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.82rem", fontWeight:700, cursor:"pointer" }}>Calculate Material Requirements</button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
}

// ── Material Planning & Measurements Modal (main button) ──────────────────────

type MPTab = "measurements" | "materialPlan";
type AlertType = "procurement" | "warehouse";

interface TooltipState { itemName: string; qty: number; type: AlertType; }

function MaterialPlanMeasurementsModal({ project, onClose }: { project:Project; onClose:()=>void }) {
  const [tab,          setTab]         = useState<MPTab>("measurements");
  const [phases,       setPhases]      = useState<ProjectPhase[]>(defaultPhases);
  const [activePhIdx,  setActivePhIdx] = useState(0);
  const [structType,   setStructType]  = useState<StructType>("Floor Slab");
  const [invCat,       setInvCat]      = useState("All");
  const [planType,     setPlanType]    = useState("");
  const [timeRange,    setTimeRange]   = useState("");
  const [expandedPhs,  setExpandedPhs] = useState<number[]>([0]);
  const [tooltip,      setTooltip]     = useState<TooltipState|null>(null);
  const [tooltipTimer, setTooltipTimer]= useState<ReturnType<typeof setTimeout>|null>(null);

  function togglePhase(idx: number) {
    setExpandedPhs(prev => prev.includes(idx) ? prev.filter(i=>i!==idx) : [...prev, idx]);
  }

  const dims = phases[activePhIdx]?.dims ?? { length:0, width:0, height:0, thickness:0.20 };

  function setDim(field: keyof ProjectPhase["dims"], val: string) {
    setPhases(prev => prev.map((ph,i) => i===activePhIdx
      ? { ...ph, dims:{ ...ph.dims, [field]:parseFloat(val)||0 } } : ph));
  }

  const vol  = structType==="Wall" ? dims.length*dims.height*dims.thickness : dims.length*dims.width*dims.thickness;
  const area = structType==="Wall" ? dims.length*dims.height : dims.length*dims.width;
  const concreteMix = vol * 0.85;
  const steelReinf  = vol * 80;
  const formwork    = area * 1.15;

  function addToPhase(inv: InventoryItem) {
    setPhases(prev => prev.map((ph,i) => {
      if (i !== activePhIdx) return ph;
      if (ph.items.find(it=>it.inventoryId===inv.id)) return ph;
      return { ...ph, items:[...ph.items, { inventoryId:inv.id, name:inv.name, spec:inv.spec, unit:inv.unit, estQty:0, stock:inv.stock, price:inv.price, category:inv.category }] };
    }));
    toast.success(`${inv.name} added to Material Plan.`);
  }

  function setItemQty(phIdx: number, inventoryId: number, val: string) {
    setPhases(prev => prev.map((ph,i) => i===phIdx
      ? { ...ph, items:ph.items.map(it=>it.inventoryId===inventoryId?{...it,estQty:parseFloat(val)||0}:it) }
      : ph));
  }

  function removeFromPhase(phIdx: number, inventoryId: number) {
    setPhases(prev => prev.map((ph,i) => i===phIdx
      ? { ...ph, items:ph.items.filter(it=>it.inventoryId!==inventoryId) } : ph));
  }

  function showAlert(itemName: string, qty: number, type: AlertType) {
    if (tooltipTimer) clearTimeout(tooltipTimer);
    setTooltip({ itemName, qty, type });
    const t = setTimeout(() => setTooltip(null), 3500);
    setTooltipTimer(t);
    if (type === "procurement") toast.success(`Purchase Requisition raised for ${itemName}.`, { icon:"🛒" });
    else toast.success(`Warehouse flagged for ${itemName} check.`, { icon:"📦" });
  }

  const allItems = phases.flatMap(ph => ph.items);
  const totalMat = allItems.length;
  const totalCost = allItems.reduce((s,it)=>s+it.estQty*it.price,0);
  const alertCount = allItems.filter(it=>it.estQty>it.stock).length;

  const filtered = invCat==="All" ? INVENTORY_ITEMS : INVENTORY_ITEMS.filter(i=>i.category===invCat);
  const sel: React.CSSProperties = { ...inp, cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"] };

  const tabStyle = (t: MPTab): React.CSSProperties => ({
    display:"flex", alignItems:"center", gap:6, padding:"10px 18px",
    border:"none", cursor:"pointer", fontSize:"0.875rem", fontWeight:tab===t?700:400,
    background:"transparent", color:tab===t?"#f97316":"#9ca3af",
    borderBottom:tab===t?"2px solid #f97316":"2px solid transparent",
    transition:"all 0.15s",
  });

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, width:660, boxShadow:"0 20px 60px rgba(0,0,0,0.18)", overflow:"hidden", maxHeight:"90vh", display:"flex", flexDirection:"column" }}>
        {/* Header */}
        <div style={{ padding:"1.5rem 1.5rem 0", flexShrink:0 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"0.25rem" }}>
            <div>
              <p style={{ fontWeight:800, fontSize:"1.15rem", color:"#111827" }}>Material Planning & Measurements</p>
              <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>{project.name}</p>
            </div>
            <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
          </div>
          {/* Tabs */}
          <div style={{ display:"flex", borderBottom:"1px solid #e5e7eb", marginTop:"0.75rem" }}>
            <button style={tabStyle("measurements")} onClick={()=>setTab("measurements")}>
              <Pencil style={{ width:14, height:14 }} /> Measurements
            </button>
            <button style={tabStyle("materialPlan")} onClick={()=>setTab("materialPlan")}>
              <FileText style={{ width:14, height:14 }} /> Material Plan
              {totalMat>0 && <span style={{ background:"#f97316", color:"#fff", borderRadius:999, fontSize:"0.62rem", fontWeight:800, padding:"1px 6px", marginLeft:2 }}>{totalMat}</span>}
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto", padding:"1.25rem 1.5rem" }}>

          {/* ── MEASUREMENTS TAB ── */}
          {tab==="measurements" && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1.6fr", gap:"1rem" }}>
              {/* Left col */}
              <div>
                <p style={{ fontSize:"0.65rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", marginBottom:"0.5rem" }}>BLUEPRINT / PDF</p>
                <div style={{ border:"2px dashed #e5e7eb", borderRadius:10, padding:"1.25rem", textAlign:"center", marginBottom:"1rem", cursor:"pointer", background:"#fafafa" }}>
                  <div style={{ width:40, height:40, borderRadius:10, background:"#fff7ed", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 0.5rem" }}>
                    <Upload style={{ width:18, height:18, color:"#f97316" }} />
                  </div>
                  <p style={{ fontSize:"0.8rem", fontWeight:600, color:"#374151" }}>Upload Blueprint PDF</p>
                  <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginTop:2 }}>Drag &amp; drop or click to browse</p>
                  <p style={{ fontSize:"0.68rem", color:"#f97316", marginTop:4, fontWeight:500 }}>Auto-fills all phase dimensions on upload</p>
                </div>

                <p style={{ fontSize:"0.65rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", marginBottom:"0.5rem" }}>PHASE SUMMARY</p>
                {phases.map((ph,i) => {
                  const v = ph.dims.length*ph.dims.width*ph.dims.thickness;
                  const a = ph.dims.length*ph.dims.width;
                  const configured = v > 0 || a > 0;
                  return (
                    <div key={ph.id} onClick={()=>setActivePhIdx(i)} style={{ padding:"0.625rem 0.875rem", borderRadius:8, marginBottom:4, cursor:"pointer", border:activePhIdx===i?"1px solid #fed7aa":"1px solid #e5e7eb", background:activePhIdx===i?"#fff7ed":"#fff" }}>
                      <p style={{ fontSize:"0.8rem", fontWeight:activePhIdx===i?700:500, color:activePhIdx===i?"#f97316":"#374151" }}>Phase {i+1}: {ph.name}</p>
                      {configured
                        ? <p style={{ fontSize:"0.68rem", color:"#9ca3af" }}>{v.toFixed(1)} m³ · {a.toFixed(1)} m²</p>
                        : <p style={{ fontSize:"0.68rem", color:"#d1d5db" }}>Not configured</p>
                      }
                    </div>
                  );
                })}
              </div>

              {/* Right col */}
              <div>
                <p style={{ fontSize:"0.75rem", color:"#9ca3af", marginBottom:"0.5rem" }}>Structure Type</p>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:"1rem" }}>
                  {(["Floor Slab","Wall","Column","Beam","Footing"] as StructType[]).map(t=>(
                    <button key={t} onClick={()=>setStructType(t)} style={{ padding:"6px 13px", borderRadius:999, border:"none", cursor:"pointer", fontSize:"0.8rem", fontWeight:structType===t?700:400, background:structType===t?"#f97316":"#f3f4f6", color:structType===t?"#fff":"#374151" }}>{t}</button>
                  ))}
                </div>

                <div style={{ border:"1px solid #e5e7eb", borderRadius:10, padding:"1rem", marginBottom:"1rem" }}>
                  <p style={{ fontWeight:700, fontSize:"0.875rem", marginBottom:"0.75rem" }}>Phase {activePhIdx+1}: {phases[activePhIdx]?.name} — Dim</p>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.625rem" }}>
                    <div><label style={lbl}>Length (M)</label><input value={dims.length||""} onChange={e=>setDim("length",e.target.value)} type="number" style={inp} placeholder="15" suppressHydrationWarning /></div>
                    <div><label style={lbl}>Width (M)</label><input value={dims.width||""} onChange={e=>setDim("width",e.target.value)} type="number" style={inp} placeholder="10" suppressHydrationWarning /></div>
                    <div><label style={lbl}>Height (M)</label><input value={dims.height||""} onChange={e=>setDim("height",e.target.value)} type="number" style={{ ...inp, background:structType==="Floor Slab"||structType==="Footing"?"#f9fafb":"#fff" }} placeholder="0.00" suppressHydrationWarning /></div>
                    <div><label style={lbl}>Thickness (M)</label><input value={dims.thickness||""} onChange={e=>setDim("thickness",e.target.value)} type="number" style={inp} placeholder="0.20" suppressHydrationWarning /></div>
                  </div>
                </div>

                {vol > 0 && (
                  <div style={{ border:"1px solid #e5e7eb", borderRadius:10, padding:"1rem" }}>
                    <p style={{ fontWeight:700, fontSize:"0.875rem", marginBottom:"0.75rem" }}>Calculated Results</p>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.625rem", marginBottom:"0.75rem" }}>
                      <div style={{ background:"#f9fafb", borderRadius:8, padding:"0.75rem", textAlign:"center" }}>
                        <p style={{ fontSize:"1.3rem", fontWeight:800, color:"#111827" }}>{vol.toFixed(2)}</p>
                        <p style={{ fontSize:"0.65rem", color:"#9ca3af" }}>m³ Volume</p>
                      </div>
                      <div style={{ background:"#f9fafb", borderRadius:8, padding:"0.75rem", textAlign:"center" }}>
                        <p style={{ fontSize:"1.3rem", fontWeight:800, color:"#111827" }}>{area.toFixed(2)}</p>
                        <p style={{ fontSize:"0.65rem", color:"#9ca3af" }}>m² Surface Area</p>
                      </div>
                    </div>
                    <div style={{ fontSize:"0.78rem", color:"#6b7280" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}><span>Concrete mix vol (85%)</span><span style={{ fontWeight:600 }}>{concreteMix.toFixed(2)} m³</span></div>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}><span>Est. steel reinforcement</span><span style={{ fontWeight:600 }}>{Math.round(steelReinf)} kg</span></div>
                      <div style={{ display:"flex", justifyContent:"space-between" }}><span>Formwork area</span><span style={{ fontWeight:600 }}>{formwork.toFixed(2)} m²</span></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── MATERIAL PLAN TAB ── */}
          {tab==="materialPlan" && (
            <>
              {/* Controls */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:"0.75rem", marginBottom:"1rem", alignItems:"end" }}>
                <div><label style={lbl}>Plan Type</label><select value={planType} onChange={e=>setPlanType(e.target.value)} style={sel}><option value="">Select…</option><option>Phase-based</option><option>Monthly</option></select></div>
                <div><label style={lbl}>Time Range</label><select value={timeRange} onChange={e=>setTimeRange(e.target.value)} style={sel}><option value="">Select…</option><option>30 days</option><option>60 days</option><option>90 days</option></select></div>
                <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:8, padding:"7px 12px", display:"flex", alignItems:"center", gap:5, whiteSpace:"nowrap" }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background:"#22c55e", display:"inline-block" }} />
                  <span style={{ fontSize:"0.75rem", color:"#15803d", fontWeight:500 }}>Forecast Applied</span>
                </div>
              </div>

              {/* Add from Inventory */}
              <div style={{ border:"1px solid #e5e7eb", borderRadius:10, padding:"1rem", marginBottom:"1rem" }}>
                <p style={{ fontWeight:700, fontSize:"0.875rem", marginBottom:"0.75rem" }}>Add from Inventory</p>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:"0.75rem" }}>
                  {INV_CATEGORIES.map(c=>(
                    <button key={c} onClick={()=>setInvCat(c)} style={{ padding:"4px 11px", borderRadius:999, border:"none", cursor:"pointer", fontSize:"0.73rem", fontWeight:invCat===c?700:400, background:invCat===c?"#111827":"#f3f4f6", color:invCat===c?"#fff":"#374151" }}>{c}</button>
                  ))}
                </div>
                <div style={{ maxHeight:140, overflowY:"auto" }}>
                  {filtered.map(inv=>(
                    <div key={inv.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 4px", borderBottom:"1px solid #f9fafb" }}>
                      <div>
                        <p style={{ fontSize:"0.8rem", fontWeight:500, color:"#111827" }}>{inv.name}</p>
                        <p style={{ fontSize:"0.65rem", color:"#9ca3af" }}>{inv.category} · Stock: {inv.stock.toLocaleString()} · ₱{inv.price.toLocaleString()}</p>
                      </div>
                      <button onClick={()=>addToPhase(inv)} style={{ width:24, height:24, borderRadius:"50%", border:"none", background:"transparent", cursor:"pointer", color:"#f97316", fontSize:"1.1rem", fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bill of Materials */}
              <div style={{ border:"1px solid #e5e7eb", borderRadius:10, overflow:"hidden", position:"relative" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0.875rem 1rem", borderBottom:"1px solid #e5e7eb" }}>
                  <p style={{ fontWeight:700, fontSize:"0.875rem" }}>Bill of Materials</p>
                  <div style={{ display:"flex", alignItems:"center", gap:6, background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:999, padding:"4px 12px" }}>
                    <span style={{ fontSize:"0.72rem", color:"#f97316" }}>▶ Forecast Applied</span>
                  </div>
                </div>
                {/* Header row */}
                <div style={{ display:"grid", gridTemplateColumns:"1.8fr 1.3fr 0.5fr 0.8fr 0.6fr 0.7fr", gap:4, padding:"0.5rem 1rem", background:"#f9fafb", borderBottom:"1px solid #e5e7eb" }}>
                  {["MATERIAL","SPECIFICATION","UNIT","EST. QTY","STOCK","ALERTS"].map(h=>(
                    <span key={h} style={{ fontSize:"0.6rem", color:"#9ca3af", fontWeight:700 }}>{h}</span>
                  ))}
                </div>

                <div style={{ maxHeight:260, overflowY:"auto" }}>
                  {phases.map((ph, phIdx) => (
                    <div key={ph.id}>
                      {/* Phase header */}
                      <button onClick={()=>togglePhase(phIdx)} style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr auto", padding:"8px 1rem", background:"#eff6ff", border:"none", cursor:"pointer", borderBottom:"1px solid #dbeafe", alignItems:"center" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          {expandedPhs.includes(phIdx) ? <ChevronDown style={{ width:13, height:13, color:"#2563eb" }} /> : <ChevronUp style={{ width:13, height:13, color:"#2563eb" }} />}
                          <span style={{ fontWeight:700, fontSize:"0.82rem", color:"#2563eb" }}>Phase {phIdx+1}: {ph.name}</span>
                        </div>
                        <span style={{ fontSize:"0.72rem", color:"#6b7280" }}>{ph.items.length} items</span>
                      </button>

                      {/* Phase rows */}
                      {expandedPhs.includes(phIdx) && ph.items.map(it => {
                        const needsAlert = it.estQty > it.stock;
                        return (
                          <div key={it.inventoryId} style={{ display:"grid", gridTemplateColumns:"1.8fr 1.3fr 0.5fr 0.8fr 0.6fr 0.7fr", gap:4, padding:"8px 1rem", borderBottom:"1px solid #f9fafb", alignItems:"center" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                              {needsAlert && <span style={{ color:"#f97316", fontSize:"0.7rem" }}>⚠</span>}
                              <span style={{ fontSize:"0.78rem", fontWeight:500, color:"#111827", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{it.name}</span>
                            </div>
                            <span style={{ fontSize:"0.72rem", color:"#9ca3af", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{it.spec}</span>
                            <span style={{ fontSize:"0.72rem", color:"#9ca3af" }}>{it.unit}</span>
                            <input value={it.estQty||""} onChange={e=>setItemQty(phIdx,it.inventoryId,e.target.value)} type="number" style={{ border:"1px solid #e5e7eb", borderRadius:6, padding:"4px 6px", fontSize:"0.78rem", width:"100%", outline:"none" }} suppressHydrationWarning />
                            <span style={{ fontSize:"0.82rem", fontWeight:700, color:it.stock===0?"#ef4444":it.stock<it.estQty?"#f97316":"#22c55e" }}>{it.stock.toLocaleString()}</span>
                            <div style={{ display:"flex", gap:4 }}>
                              <button onClick={()=>showAlert(it.name,it.estQty,"procurement")} title="Raise Purchase Requisition" style={{ width:26, height:26, borderRadius:6, border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", background:needsAlert?"#fee2e2":"#f3f4f6" }}>
                                <ShoppingCart style={{ width:13, height:13, color:needsAlert?"#ef4444":"#9ca3af" }} />
                              </button>
                              <button onClick={()=>showAlert(it.name,it.estQty,"warehouse")} title="Flag for Warehouse Check" style={{ width:26, height:26, borderRadius:6, border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", background:needsAlert?"#fee2e2":"#f3f4f6" }}>
                                <Package style={{ width:13, height:13, color:needsAlert?"#ef4444":"#9ca3af" }} />
                              </button>
                              <button onClick={()=>removeFromPhase(phIdx,it.inventoryId)} style={{ width:26, height:26, borderRadius:6, border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", background:"transparent" }}>
                                <X style={{ width:12, height:12, color:"#d1d5db" }} />
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Add row */}
                      {expandedPhs.includes(phIdx) && (
                        <button onClick={()=>{ setTab("materialPlan"); setActivePhIdx(phIdx); }} style={{ width:"100%", padding:"6px", border:"none", background:"transparent", cursor:"pointer", fontSize:"0.75rem", color:"#9ca3af", borderBottom:"1px solid #f9fafb" }}>
                          + + Add Row
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Tooltip overlay */}
                {tooltip && (
                  <div style={{ position:"absolute", bottom:80, left:"50%", transform:"translateX(-50%)", background:"#111827", color:"#fff", borderRadius:10, padding:"0.875rem 1rem", width:300, zIndex:10, boxShadow:"0 8px 24px rgba(0,0,0,0.25)" }}>
                    <div style={{ display:"flex", gap:8 }}>
                      <div style={{ width:28, height:28, borderRadius:"50%", background:"#374151", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        {tooltip.type==="procurement" ? <ShoppingCart style={{ width:13, height:13, color:"#fff" }} /> : <Package style={{ width:13, height:13, color:"#fff" }} />}
                      </div>
                      <div>
                        <p style={{ fontWeight:700, fontSize:"0.8rem" }}>
                          {tooltip.type==="procurement" ? `Purchase Requisition Raised — ${tooltip.itemName} (${tooltip.qty})` : `Warehouse Flagged — ${tooltip.itemName} (${tooltip.qty})`}
                        </p>
                        <p style={{ fontSize:"0.7rem", color:"#9ca3af", marginTop:3, lineHeight:1.4 }}>
                          {tooltip.type==="procurement"
                            ? `Current stock: ${INVENTORY_ITEMS.find(i=>i.name===tooltip.itemName)?.stock??0} ${INVENTORY_ITEMS.find(i=>i.name===tooltip.itemName)?.unit??""}  | Required: ${tooltip.qty}. Procurement team notified.`
                            : `Inventory system notified to verify physical stock. Allocation check initiated.`}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Legend */}
                <div style={{ padding:"0.5rem 1rem", background:"#fafafa", borderTop:"1px solid #e5e7eb", display:"flex", gap:12 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}><ShoppingCart style={{ width:11, height:11, color:"#ef4444" }} /><span style={{ fontSize:"0.65rem", color:"#6b7280" }}>Procurement alert</span></div>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}><Package style={{ width:11, height:11, color:"#f97316" }} /><span style={{ fontSize:"0.65rem", color:"#6b7280" }}>Warehouse alert</span></div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"0.875rem 1.5rem", borderTop:"1px solid #e5e7eb", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
          {tab === "materialPlan"
            ? <p style={{ fontSize:"0.78rem", color:"#6b7280" }}>{totalMat} materials · Est. <strong>₱{totalCost.toLocaleString()}</strong>{alertCount>0&&<span style={{ color:"#f97316", marginLeft:6 }}>⚠ {alertCount} alert(s)</span>}</p>
            : <p style={{ fontSize:"0.72rem", color:"#9ca3af" }}>Enter dims per phase → Run Forecast</p>
          }
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.82rem", cursor:"pointer" }}>Cancel</button>
            {tab === "materialPlan"
              ? <button onClick={()=>{ toast.success("Material plan saved!"); onClose(); }} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.82rem", fontWeight:700, cursor:"pointer" }}>Save Plan</button>
              : <button onClick={()=>{ toast.success("Forecast generated!"); }} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.82rem", fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>▶ Run Forecast</button>
            }
          </div>
        </div>
      </div>
    </Overlay>
  );
}

// ── File Repository Modal ─────────────────────────────────────────────────────

type RepoTab = "upload" | "repository";
const CATEGORIES = ["Blueprint / Drawing","Contract / Agreement","Other Record"] as const;

function FileRepositoryModal({ onClose }: { onClose:()=>void }) {
  const [tab,       setTab]      = useState<RepoTab>("upload");
  const [files,     setFiles]    = useState<RepoFile[]>(INIT_REPO);
  const [docName,   setDocName]  = useState("");
  const [category,  setCategory] = useState<typeof CATEGORIES[number]>("Blueprint / Drawing");
  const [version,   setVersion]  = useState("V1.0");
  const [remarks,   setRemarks]  = useState("");
  const [fileQ,     setFileQ]    = useState(0);
  const [search,    setSearch]   = useState("");

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) setFileQ(prev => prev + e.target.files!.length);
  }

  function saveToRepo() {
    if (!docName.trim()) { toast.error("Document name is required."); return; }
    const newFile: RepoFile = { id:Date.now(), name:docName.trim(), category, status:"Draft", revision:version, docType:category.split(" ")[0], project:"—", author:"Ana Bonifacio", date:new Date().toISOString().split("T")[0], size:"—", description:remarks, tags:[] };
    setFiles(prev=>[newFile,...prev]);
    toast.success(`"${docName}" saved to repository.`);
    setTab("repository"); setDocName(""); setRemarks(""); setFileQ(0);
  }

  function deleteFile(id: number) {
    setFiles(prev=>prev.filter(f=>f.id!==id));
    toast.success("File removed from repository.");
  }

  const filtered = files.filter(f => !search || f.name.toLowerCase().includes(search.toLowerCase()) || f.project.toLowerCase().includes(search.toLowerCase()));

  const catIcon = (cat: string) => {
    if (cat.includes("Blueprint")) return { bg:"#dbeafe", color:"#1d4ed8" };
    if (cat.includes("Contract")) return { bg:"#dcfce7", color:"#15803d" };
    return { bg:"#ffedd5", color:"#c2410c" };
  };

  const sel: React.CSSProperties = { ...inp, cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"] };
  const tabStyle = (t: RepoTab): React.CSSProperties => ({
    padding:"10px 18px", border:"none", cursor:"pointer", fontSize:"0.875rem",
    fontWeight:tab===t?700:400, background:"transparent",
    color:tab===t?"#f97316":"#9ca3af",
    borderBottom:tab===t?"2px solid #f97316":"2px solid transparent",
  });

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, width:560, boxShadow:"0 20px 60px rgba(0,0,0,0.18)", display:"flex", flexDirection:"column", maxHeight:"90vh", overflow:"hidden" }}>
        {/* Header */}
        <div style={{ padding:"1.5rem 1.5rem 0", flexShrink:0 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1rem" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ width:44, height:44, borderRadius:10, background:"#111827", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Upload style={{ width:20, height:20, color:"#fff" }} />
              </div>
              <div>
                <p style={{ fontWeight:800, fontSize:"1.1rem", color:"#111827" }}>File Repository</p>
                <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginTop:1 }}>Blueprints, contracts, and project records</p>
              </div>
            </div>
            <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
          </div>
          <div style={{ display:"flex", borderBottom:"1px solid #e5e7eb" }}>
            <button style={tabStyle("upload")} onClick={()=>setTab("upload")}>Upload Files</button>
            <button style={tabStyle("repository")} onClick={()=>setTab("repository")}>Repository ({files.length})</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto", padding:"1.25rem 1.5rem" }}>

          {tab==="upload" && (
            <>
              <div style={{ border:"2px dashed #e5e7eb", borderRadius:12, padding:"2rem", textAlign:"center", marginBottom:"1.25rem", cursor:"pointer", background:"#fafafa" }} onClick={()=>document.getElementById("fileInput")?.click()}>
                <input id="fileInput" type="file" multiple accept=".pdf,.dwg,.docx,.xlsx,.png,.jpg" onChange={handleFileInput} style={{ display:"none" }} />
                <Upload style={{ width:28, height:28, color:"#9ca3af", margin:"0 auto 0.625rem" }} />
                <p style={{ fontSize:"0.875rem", color:"#374151" }}>Drag &amp; drop or <span style={{ color:"#f97316", fontWeight:600, cursor:"pointer" }}>browse</span> to attach a file</p>
                <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginTop:4 }}>PDF, DWG, DOCX, XLSX, PNG, JPG — max 100 MB</p>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:"0.875rem" }}>
                <div><label style={lbl}>Document Name <span style={{ color:"#ef4444" }}>*</span></label><input value={docName} onChange={e=>setDocName(e.target.value)} style={inp} placeholder="Architectural Floor Plan - Building A" suppressHydrationWarning /></div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
                  <div><label style={lbl}>Category <span style={{ color:"#ef4444" }}>*</span></label><select value={category} onChange={e=>setCategory(e.target.value as typeof CATEGORIES[number])} style={sel}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
                  <div><label style={lbl}>Version / Revision</label><input value={version} onChange={e=>setVersion(e.target.value)} style={inp} placeholder="V1.0" suppressHydrationWarning /></div>
                </div>
                <div><label style={lbl}>Description / Remarks</label><textarea value={remarks} onChange={e=>setRemarks(e.target.value)} rows={3} style={{ ...inp, resize:"vertical" as React.CSSProperties["resize"] }} placeholder="Brief description of the document contents..." suppressHydrationWarning /></div>
              </div>

              <div style={{ border:"2px dashed #e5e7eb", borderRadius:8, padding:"0.875rem", textAlign:"center", marginTop:"1rem", cursor:"pointer" }} onClick={()=>document.getElementById("fileInput")?.click()}>
                <span style={{ fontSize:"0.82rem", color:"#9ca3af" }}>+ Add Another File</span>
              </div>
            </>
          )}

          {tab==="repository" && (
            <>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem", marginBottom:"1rem" }}>
                <div style={{ position:"relative" }}>
                  <Search style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", width:14, height:14, color:"#9ca3af" }} />
                  <input value={search} onChange={e=>setSearch(e.target.value)} style={{ ...inp, paddingLeft:32 }} placeholder="Floor Plan" suppressHydrationWarning />
                </div>
                <select style={{ ...inp, cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"] }}><option>All Projects</option><option>Metro Station Phase 3</option><option>BGC Tower Complex</option></select>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:"0.75rem" }}>
                {filtered.map(f => {
                  const ic = catIcon(f.category);
                  return (
                    <div key={f.id} style={{ border:"1px solid #e5e7eb", borderRadius:10, padding:"1rem" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"0.5rem" }}>
                        <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                          <div style={{ width:32, height:32, borderRadius:8, background:ic.bg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                            <FolderOpen style={{ width:15, height:15, color:ic.color }} />
                          </div>
                          <div>
                            <p style={{ fontWeight:700, fontSize:"0.875rem", color:"#111827" }}>{f.name}</p>
                            <div style={{ display:"flex", gap:5, marginTop:4, flexWrap:"wrap" }}>
                              <span style={{ fontSize:"0.65rem", fontWeight:600, padding:"2px 8px", borderRadius:999, background:ic.bg, color:ic.color }}>{f.category}</span>
                              <span style={{ fontSize:"0.65rem", fontWeight:600, padding:"2px 8px", borderRadius:999, background:"#dcfce7", color:"#15803d" }}>{f.status}</span>
                              {f.revision && <span style={{ fontSize:"0.65rem", color:"#9ca3af" }}>{f.revision}</span>}
                            </div>
                          </div>
                        </div>
                        <button onClick={()=>deleteFile(f.id)} style={{ background:"none", border:"none", cursor:"pointer", color:"#d1d5db", padding:4 }}>
                          <Trash2 style={{ width:15, height:15 }} />
                        </button>
                      </div>
                      <p style={{ fontSize:"0.72rem", color:"#6b7280", marginBottom:2 }}>{f.docType} · {f.project}</p>
                      <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginBottom:4 }}>{f.author} · {f.date}{f.size!=="—"?` · ${f.size}`:""}</p>
                      {f.description && <p style={{ fontSize:"0.72rem", color:"#6b7280", marginBottom:6 }}>{f.description}</p>}
                      {f.tags.length>0 && (
                        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                          {f.tags.map(tag=>(
                            <span key={tag} style={{ display:"flex", alignItems:"center", gap:3, fontSize:"0.65rem", padding:"2px 8px", borderRadius:999, background:"#f3f4f6", color:"#374151" }}>
                              <Tag style={{ width:9, height:9 }} />{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {filtered.length===0 && <p style={{ textAlign:"center", color:"#9ca3af", fontSize:"0.875rem", padding:"2rem" }}>No files found.</p>}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"0.875rem 1.5rem", borderTop:"1px solid #e5e7eb", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
          {tab==="upload"
            ? <p style={{ fontSize:"0.78rem", color:"#9ca3af" }}>{fileQ>0?`${fileQ} file(s) queued`:"No file selected"}</p>
            : <p style={{ fontSize:"0.78rem", color:"#9ca3af" }}>{filtered.length} of {files.length} records</p>
          }
          <div style={{ display:"flex", gap:8 }}>
            {tab==="upload"
              ? <>
                  <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.82rem", cursor:"pointer" }}>Cancel</button>
                  <button onClick={saveToRepo} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.82rem", fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}><Upload style={{ width:13, height:13 }} /> Save to Repository</button>
                </>
              : <>
                  <button onClick={()=>setTab("upload")} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.82rem", cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>+ Upload New</button>
                  <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.82rem", cursor:"pointer" }}>Close</button>
                </>
            }
          </div>
        </div>
      </div>
    </Overlay>
  );
}

// ── Reports Modal ─────────────────────────────────────────────────────────────

function ReportsModal({ project, onClose }: { project:Project; onClose:()=>void }) {
  const [type, setType] = useState("Material Usage");
  const [from, setFrom] = useState("2026-05-01");
  const [to,   setTo]   = useState("2026-06-01");
  const [fmt,  setFmt]  = useState(".PDF");
  const dark: React.CSSProperties = { ...inp, background:"#1e2d50", border:"1px solid rgba(255,255,255,0.1)", color:"#fff" };
  const dsel: React.CSSProperties = { ...dark, cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"] };
  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#1a2235", borderRadius:16, padding:"1.75rem", width:460, boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"1rem" }}>
          <div><p style={{ fontWeight:800, fontSize:"1.05rem", color:"#fff" }}>Generate Report</p><p style={{ fontSize:"0.75rem", color:"#9ca3af", marginTop:2 }}>{project.name}</p></div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.75rem" }}>
          <div><label style={{ ...lbl, color:"#9ca3af" }}>Report Type</label><select value={type} onChange={e=>setType(e.target.value)} style={{ ...dsel, width:"100%" }}>{["Material Usage","Procurement Summary","Cost Report","Excess Analytics","Forecast Report"].map(t=><option key={t}>{t}</option>)}</select></div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            <div><label style={{ ...lbl, color:"#9ca3af" }}>From</label><input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{ ...dark, width:"100%", boxSizing:"border-box" as const }} suppressHydrationWarning /></div>
            <div><label style={{ ...lbl, color:"#9ca3af" }}>To</label><input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{ ...dark, width:"100%", boxSizing:"border-box" as const }} suppressHydrationWarning /></div>
          </div>
          <div><label style={{ ...lbl, color:"#9ca3af" }}>Format</label><select value={fmt} onChange={e=>setFmt(e.target.value)} style={{ ...dsel, width:"100%" }}>{[".PDF",".CSV",".XLSX"].map(f=><option key={f}>{f}</option>)}</select></div>
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", background:"transparent", color:"#d1d5db", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={()=>{ toast.success(`${type} report generating…`); onClose(); }} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>Generate</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Forecast Mini Chart Modal ─────────────────────────────────────────────────

function ForecastModal({ project, onClose }: { project:Project; onClose:()=>void }) {
  const weeks = ["Wk 1","Wk 2","Wk 3","Wk 4","Wk 5","Wk 6","Wk 7","Wk 8"];
  const data  = weeks.map((wk,i) => ({ week:wk, Cement:Math.round(30*(i+1)*0.8*Math.sin((i/7)*Math.PI)*0.6+0.4), Steel:Math.round(15*(i+1)*0.7), Gravel:Math.round(20*(i+1)*0.9) }));
  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:580 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"1rem" }}>
          <div><p style={{ fontWeight:800, fontSize:"1.05rem" }}>Material Forecast</p><p style={{ fontSize:"0.75rem", color:"#9ca3af" }}>{project.name} — 8-week projection</p></div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top:4, right:8, left:-20, bottom:0 }}>
            <defs>
              {[["C","#f97316"],["S","#22c55e"],["G","#3b82f6"]].map(([k,c])=>(
                <linearGradient key={k} id={`g${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={c} stopOpacity={0.3}/><stop offset="95%" stopColor={c} stopOpacity={0}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
            <XAxis dataKey="week" tick={{ fontSize:11, fill:"#9ca3af" }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fontSize:11, fill:"#9ca3af" }} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={{ borderRadius:8, border:"1px solid #e5e7eb", fontSize:"0.72rem" }}/>
            <Legend iconType="plainline" wrapperStyle={{ fontSize:"0.72rem", paddingTop:8 }}/>
            <Area type="monotone" dataKey="Cement" stroke="#f97316" strokeWidth={2} fill="url(#gC)"/>
            <Area type="monotone" dataKey="Steel"  stroke="#22c55e" strokeWidth={2} fill="url(#gS)"/>
            <Area type="monotone" dataKey="Gravel" stroke="#3b82f6" strokeWidth={2} fill="url(#gG)"/>
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ display:"flex", justifyContent:"flex-end", marginTop:"1rem" }}>
          <button onClick={onClose} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontWeight:700, fontSize:"0.875rem", cursor:"pointer" }}>Done</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Progress Tracker Modal ────────────────────────────────────────────────────

interface ProgressUpdate {
  id: number; date: string; progress: number;
  notes: string; updatedBy: string;
}

function ProgressTrackerModal({ project, onClose, onSave }: {
  project: Project;
  onClose: ()=>void;
  onSave: (progress: number) => void;
}) {
  const { user } = useAuthStore();
  const [progress, setProgress] = useState(project.progress);
  const [notes, setNotes]       = useState("");
  const [photos, setPhotos]     = useState<File[]>([]);
  const [updates, setUpdates]   = useState<ProgressUpdate[]>(() => {
    const base = project.progress;
    return [
      { id:1, date:"2026-09-10", progress:Math.max(base-8,0),  notes:"Completed column pour for Grid A1-A5. Forms removed and inspected by QC.",            updatedBy:"Carlo Reyes" },
      { id:2, date:"2026-09-05", progress:Math.max(base-15,0), notes:"Rebar installation completed. Steel bar placement inspected and cleared.",              updatedBy:"Carlo Reyes" },
      { id:3, date:"2026-08-28", progress:Math.max(base-22,0), notes:"Foundation excavation and sub-base compaction done. Ready for footing formwork.",       updatedBy:"Maria Tan"   },
    ].filter(u => u.progress > 0);
  });

  const PHASES = ["Foundation","Structural Framing","Finishing","MEP"];

  function handleSave() {
    if (!notes.trim()) { toast.error("Please add progress notes before saving."); return; }
    const newUpdate: ProgressUpdate = {
      id: Date.now(), date: new Date().toISOString().split("T")[0],
      progress, notes,
      updatedBy: user ? `${user.firstName} ${user.lastName}` : "Current User",
    };
    setUpdates(prev => [newUpdate, ...prev]);
    onSave(progress);
    toast.success("Progress updated successfully!");
    setNotes(""); setPhotos([]);
  }

  const phaseThresholds = [25, 50, 75, 100];

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"2rem", width:580, boxShadow:"0 20px 60px rgba(0,0,0,0.18)" }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.5rem" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <Activity style={{ width:18, height:18, color:"#f97316" }} />
              <p style={{ fontWeight:800, fontSize:"1.1rem", color:"#111827" }}>Progress Tracker</p>
            </div>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:3 }}>{project.name} · {project.location}</p>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>

        {/* Progress bar + slider */}
        <div style={{ background:"#f9fafb", borderRadius:12, padding:"1.25rem", marginBottom:"1.25rem" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
            <span style={{ fontSize:"0.8rem", fontWeight:600, color:"#374151" }}>Overall Progress</span>
            <span style={{ fontSize:"1.25rem", fontWeight:800, color:project.progressColor }}>{progress}%</span>
          </div>
          <div style={{ height:14, background:"#e5e7eb", borderRadius:99, marginBottom:"0.875rem", overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${progress}%`, background:project.progressColor, borderRadius:99, transition:"width 0.25s ease" }} />
          </div>
          <input type="range" min={0} max={100} step={1} value={progress}
            onChange={e=>setProgress(Number(e.target.value))}
            style={{ width:"100%", accentColor:project.progressColor, cursor:"pointer" }}
          />
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
            <span style={{ fontSize:"0.65rem", color:"#9ca3af" }}>0%</span>
            <span style={{ fontSize:"0.65rem", color:"#9ca3af" }}>25%</span>
            <span style={{ fontSize:"0.65rem", color:"#9ca3af" }}>50%</span>
            <span style={{ fontSize:"0.65rem", color:"#9ca3af" }}>75%</span>
            <span style={{ fontSize:"0.65rem", color:"#9ca3af" }}>100%</span>
          </div>
        </div>

        {/* Phase status */}
        <div style={{ marginBottom:"1.25rem" }}>
          <p style={{ fontSize:"0.78rem", fontWeight:700, color:"#374151", marginBottom:8 }}>Phase Status</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {PHASES.map((phase, i) => {
              const threshold = phaseThresholds[i];
              const prevThreshold = i === 0 ? 0 : phaseThresholds[i-1];
              const done   = progress >= threshold;
              const inProg = !done && progress >= prevThreshold;
              return (
                <div key={phase} style={{
                  display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
                  background: done ? "#dcfce7" : inProg ? "#fff7ed" : "#f9fafb",
                  borderRadius:8,
                  border: `1px solid ${done ? "#86efac" : inProg ? "#fed7aa" : "#e5e7eb"}`,
                }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", flexShrink:0,
                    background: done ? "#22c55e" : inProg ? "#f97316" : "#d1d5db" }} />
                  <span style={{ fontSize:"0.75rem", fontWeight:600,
                    color: done ? "#15803d" : inProg ? "#c2410c" : "#9ca3af" }}>{phase}</span>
                  <span style={{ fontSize:"0.65rem", color:"#9ca3af", marginLeft:"auto" }}>
                    {done ? "Done" : inProg ? "In Progress" : "Pending"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Update form */}
        <div style={{ marginBottom:"1.25rem" }}>
          <p style={{ fontSize:"0.78rem", fontWeight:700, color:"#374151", marginBottom:8 }}>Log Progress Update</p>
          <textarea
            placeholder="Describe work completed (e.g., Completed column pour for Grid A1-A5, forms removed and passed QC inspection...)"
            value={notes} onChange={e=>setNotes(e.target.value)}
            style={{ ...inp, minHeight:76, resize:"vertical" as const }}
          />
          <label style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, padding:"9px 14px", border:"1.5px dashed #d1d5db", borderRadius:8, cursor:"pointer", background:"#fafafa" }}>
            <Camera style={{ width:15, height:15, color:"#9ca3af" }} />
            <span style={{ fontSize:"0.78rem", color:"#6b7280" }}>
              {photos.length > 0 ? `${photos.length} photo(s) selected` : "Attach site photos (optional)"}
            </span>
            <input type="file" accept="image/*" multiple style={{ display:"none" }}
              onChange={e => setPhotos(Array.from(e.target.files ?? []))} />
          </label>
        </div>

        {/* Update history */}
        {updates.length > 0 && (
          <div style={{ marginBottom:"1.25rem" }}>
            <p style={{ fontSize:"0.78rem", fontWeight:700, color:"#374151", marginBottom:8 }}>Recent Updates</p>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {updates.slice(0,3).map(u => (
                <div key={u.id} style={{ padding:"10px 12px", background:"#f9fafb", borderRadius:8, borderLeft:"3px solid #f97316" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                    <span style={{ fontSize:"0.7rem", fontWeight:700, color:"#f97316" }}>{u.progress}% progress</span>
                    <span style={{ fontSize:"0.68rem", color:"#9ca3af" }}>{u.date}</span>
                  </div>
                  <p style={{ fontSize:"0.75rem", color:"#374151", lineHeight:1.4 }}>{u.notes}</p>
                  <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginTop:3 }}>Updated by {u.updatedBy}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>Save Update</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Project Card ──────────────────────────────────────────────────────────────

function ProjectCard({ project, onEdit, onMaterialPlan, onReports, onProgress, canEdit, showProgress, viewOnly }: {
  project: Project;
  onEdit: ()=>void;
  onMaterialPlan: ()=>void;
  onReports: ()=>void;
  onProgress?: ()=>void;
  canEdit: boolean;
  showProgress: boolean;
  viewOnly: boolean;
}) {
  const st = STATUS_STYLE[project.status];
  const btn: React.CSSProperties = { flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6, padding:"10px 0", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.8rem", fontWeight:600, cursor:"pointer" };
  return (
    <div style={{ background:"#fff", borderRadius:14, padding:"1.25rem", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
      {/* Title row */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"0.375rem" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, minWidth:0 }}>
          <p style={{ fontWeight:700, fontSize:"1rem", color:"#1d4ed8", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{project.name}</p>
          {canEdit && (
            <button onClick={onEdit} style={{ background:"none", border:"none", cursor:"pointer", padding:0, color:"#9ca3af", display:"flex", alignItems:"center", flexShrink:0 }}>
              <Pencil style={{ width:13, height:13 }} />
            </button>
          )}
          {viewOnly && (
            <span style={{ fontSize:"0.6rem", fontWeight:700, padding:"2px 7px", borderRadius:999, background:"#f3f4f6", color:"#6b7280", flexShrink:0 }}>VIEW ONLY</span>
          )}
        </div>
        <span style={{ fontSize:"0.65rem", fontWeight:700, padding:"3px 10px", borderRadius:999, background:st.bg, color:st.color, whiteSpace:"nowrap", flexShrink:0 }}>· {project.status}</span>
      </div>

      {/* Meta */}
      <div style={{ display:"flex", gap:14, marginBottom:"0.875rem", flexWrap:"wrap" }}>
        <span style={{ fontSize:"0.72rem", color:"#9ca3af", display:"flex", alignItems:"center", gap:3 }}><MapPin style={{ width:11, height:11 }} />{project.location}</span>
        <span style={{ fontSize:"0.72rem", color:"#9ca3af", display:"flex", alignItems:"center", gap:3 }}><Calendar style={{ width:11, height:11 }} />{project.startDate} – {project.endDate}</span>
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
        {[["Budget",project.budget],["Spent",project.spent],["Materials",`${project.materials} items`]].map(([l,v])=>(
          <div key={l} style={{ background:"#f9fafb", borderRadius:8, padding:"0.5rem 0.75rem" }}>
            <p style={{ fontSize:"0.6rem", color:"#9ca3af" }}>{l}</p>
            <p style={{ fontWeight:700, fontSize:"0.85rem", color:"#111827" }}>{v}</p>
          </div>
        ))}
      </div>

      {/* Team */}
      <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:"0.875rem" }}>
        <Users style={{ width:11, height:11, color:"#9ca3af" }} />
        <span style={{ fontSize:"0.7rem", color:"#6b7280" }}>{project.manager}{project.engineers.length>0&&` · Engineers: ${project.engineers.join(", ")}`}</span>
      </div>

      {/* Action buttons */}
      <div style={{ display:"flex", gap:"0.5rem" }}>
        <button onClick={onMaterialPlan} style={btn}><FileText style={{ width:13, height:13 }} /> Material Plan &amp; Measurements</button>
        {showProgress && project.status !== "COMPLETED" && (
          <button onClick={onProgress} style={{ ...btn, flex:"0 0 auto", padding:"10px 14px", background:"#1e3154" }}>
            <Activity style={{ width:13, height:13 }} /> Progress
          </button>
        )}
        <button onClick={onReports} style={{ ...btn, flex:"0 0 auto", padding:"10px 16px" }}><BarChart3 style={{ width:13, height:13 }} /> Reports</button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type ModalState =
  | { type:"new" }
  | { type:"edit"; project:Project }
  | { type:"materialPlan"; project:Project }
  | { type:"reports"; project:Project }
  | { type:"forecast"; project:Project }
  | { type:"repository" }
  | { type:"progress"; project:Project }
  | null;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>(INIT_PROJECTS);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState<ModalState>(null);
  const { user } = useAuthStore();
  const role = user?.role ?? "SiteEngineer";

  // Role-based permissions
  const canCreate    = role === "Admin" || role === "ProjectManager";
  const canEdit      = role === "Admin" || role === "ProjectManager" || role === "SiteEngineer";
  const showProgress = role === "Admin" || role === "ProjectManager" || role === "SiteEngineer";
  const viewOnly     = role === "ProcurementOfficer";

  useEffect(() => {
    api.get<ProjectResponseDto[]>("/projects")
      .then(r => setProjects(r.data.map(toProject)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const proj = modal && "project" in modal ? modal.project : undefined;

  return (
    <div style={{ background:"#f5f4f0", minHeight:"100vh" }}>
      {modal?.type==="new"          && <NewProjectModal onClose={()=>setModal(null)} onCreate={p=>setProjects(prev=>[...prev,p])} />}
      {modal?.type==="edit"         && proj && <EditProjectDetailsModal project={proj} onClose={()=>setModal(null)} />}
      {modal?.type==="materialPlan" && proj && <MaterialPlanMeasurementsModal project={proj} onClose={()=>setModal(null)} />}
      {modal?.type==="reports"      && proj && <ReportsModal project={proj} onClose={()=>setModal(null)} />}
      {modal?.type==="forecast"     && proj && <ForecastModal project={proj} onClose={()=>setModal(null)} />}
      {modal?.type==="repository"   && <FileRepositoryModal onClose={()=>setModal(null)} />}
      {modal?.type==="progress"     && proj && (
        <ProgressTrackerModal
          project={proj}
          onClose={()=>setModal(null)}
          onSave={(progress) => {
            setProjects(prev => prev.map(p => p.id === proj.id ? { ...p, progress } : p));
            setModal(null);
          }}
        />
      )}

      <Header title="Projects" />

      <div style={{ padding:"1.25rem 1.5rem" }}>
        {/* Page header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem" }}>
          <div>
            <p style={{ fontWeight:800, fontSize:"1.35rem", color:"#111827" }}>All Projects</p>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>
              {loading ? "Loading…" : `${projects.length} projects · ${projects.filter(p=>p.status==="ACTIVE").length} active`}
            </p>
          </div>
          <div style={{ display:"flex", gap:"0.625rem" }}>
            {canCreate && (
              <button onClick={()=>setModal({type:"repository"})} style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 18px", borderRadius:10, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", fontWeight:600, cursor:"pointer" }}>
                <Upload style={{ width:14, height:14 }} /> Import Files
              </button>
            )}
            {canCreate && (
              <button onClick={()=>setModal({type:"new"})} style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 20px", borderRadius:10, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>
                <Plus style={{ width:15, height:15 }} /> New Project
              </button>
            )}
          </div>
        </div>

        {/* Project grid */}
        {loading ? (
          <div style={{ padding:"3rem", textAlign:"center", color:"#9ca3af" }}>Loading projects…</div>
        ) : projects.length === 0 ? (
          <div style={{ padding:"3rem", textAlign:"center", color:"#9ca3af" }}>No projects yet. Click "+ New Project" to get started.</div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem" }}>
            {projects.map(p => (
              <ProjectCard
                key={p.id}
                project={p}
                onEdit={()=>setModal({type:"edit",project:p})}
                onMaterialPlan={()=>setModal({type:"materialPlan",project:p})}
                onReports={()=>setModal({type:"reports",project:p})}
                onProgress={()=>setModal({type:"progress",project:p})}
                canEdit={canEdit}
                showProgress={showProgress}
                viewOnly={viewOnly}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
