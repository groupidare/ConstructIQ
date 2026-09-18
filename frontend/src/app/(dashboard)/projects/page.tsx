"use client";

import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import api from "@/lib/api";
import Header from "@/components/layout/Header";
import { useAuthStore } from "@/store/authStore";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { exportReport } from "@/lib/reportExport";
import MeasurementsAndMaterialPlan from "@/components/projects/MeasurementsAndMaterialPlan";
import NewProjectWizardModal from "@/components/projects/NewProjectWizardModal";
import AddCompletedProjectWizardModal from "@/components/projects/AddCompletedProjectWizardModal";
import { useDocumentRepository } from "@/hooks/useDocumentRepository";
import { getApiOrigin } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { Project as RealProject } from "@/types/project";
import type { ProjectDocument } from "@/types/document";
import {
  Plus, MapPin, Calendar, Users, FileText, X, Eye,
  Upload, FolderOpen, Trash2, Search, BarChart3, Camera, Activity, History, ExternalLink, File as FileIcon,
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


// ── Static Data ────────────────────────────────────────────────────────────────

const INIT_PROJECTS: Project[] = [
  { id:1, name:"Metro Station Phase 3",   location:"EDSA, QC",     startDate:"2024-08-01", endDate:"2026-03-31", status:"ACTIVE",    progress:62,  progressColor:"#f97316", budget:"₱45.0M",  spent:"₱27.9M", materials:8,  manager:"Remy Santos",  engineers:["Carlos Reyes","Maria Tan"],   type:"Infrastructure" },
  { id:2, name:"BGC Tower Complex",        location:"BGC, Taguig",  startDate:"2025-01-15", endDate:"2027-06-30", status:"ACTIVE",    progress:38,  progressColor:"#1e3154", budget:"₱120.0M", spent:"₱45.6M", materials:12, manager:"Remy Santos",  engineers:["Jose Lim"],                  type:"Commercial" },
  { id:3, name:"Harbor Bridge Renovation", location:"Manila Harbor", startDate:"2024-03-01", endDate:"2025-12-31", status:"ACTIVE",    progress:81,  progressColor:"#22c55e", budget:"₱28.0M",  spent:"₱22.7M", materials:6,  manager:"Remy Santos",  engineers:["Carlos Reyes"],              type:"Infrastructure" },
  { id:4, name:"Southgate Mall Expansion", location:"BGC, Taguig",  startDate:"2025-06-01", endDate:"2027-09-30", status:"PLANNING",  progress:12,  progressColor:"#374151", budget:"₱75.0M",  spent:"₱9.0M",  materials:4,  manager:"Remy Santos",  engineers:["Ana Cruz","Ben Torres"],     type:"Commercial" },
  { id:5, name:"PUP ICTC Building",        location:"Sta. Mesa",    startDate:"2023-01-10", endDate:"2025-01-15", status:"COMPLETED", progress:100, progressColor:"#22c55e", budget:"₱19.3M",  spent:"₱19.1M", materials:9,  manager:"Remy Santos",  engineers:["Ana Cruz"],                  type:"Infrastructure" },
];

// ── API ────────────────────────────────────────────────────────────────────────

type ProjectResponseDto = RealProject;

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

const lbl: React.CSSProperties = { display:"block", fontSize:"0.72rem", color:"#6b7280", fontWeight:500, marginBottom:4 };

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ── Overlay ────────────────────────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:"1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ maxHeight:"90vh", overflowY:"auto", borderRadius:16 }}>
        {children}
      </div>
    </div>
  );
}

// ── File Repository Modal ─────────────────────────────────────────────────────

type RepoTab = "upload" | "repository";

function categoryDisplay(doc: ProjectDocument): { label: string; bg: string; color: string } {
  switch (doc.category) {
    case "Blueprint":     return { label: "Blueprint / Drawing", bg: "#dbeafe", color: "#1d4ed8" };
    case "Contract":      return { label: "Contract / Agreement", bg: "#dcfce7", color: "#15803d" };
    case "BOQ":           return { label: "Bill of Quantities", bg: "#eff6ff", color: "#2563eb" };
    case "PurchaseOrder": return { label: "Purchase Order", bg: "#fff7ed", color: "#c2410c" };
    default:
      return doc.categoryOther
        ? { label: `Others — ${doc.categoryOther}`, bg: "#ffedd5", color: "#c2410c" }
        : { label: "Other Record", bg: "#ffedd5", color: "#c2410c" };
  }
}

interface StagedFile { id: string; file: File; previewUrl: string }

function FileRepositoryModal({ onClose, projects }: { onClose:()=>void; projects: RealProject[] }) {
  const { documents, fetchAll, upload, remove } = useDocumentRepository();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab,           setTab]           = useState<RepoTab>("upload");
  const [staged,         setStaged]        = useState<StagedFile[]>([]);
  const [projectId,      setProjectId]     = useState<number | "">("");
  const [description,    setDescription]   = useState("");
  const [saving,         setSaving]        = useState(false);
  const [search,         setSearch]        = useState("");
  const [projectFilter,  setProjectFilter] = useState<number | "">("");

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (picked && picked.length > 0) {
      const additions: StagedFile[] = Array.from(picked).map(file => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      setStaged(prev => [...prev, ...additions]);
    }
    e.target.value = "";
  }

  function removeStaged(id: string) {
    setStaged(prev => {
      const target = prev.find(s => s.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(s => s.id !== id);
    });
  }

  async function saveToRepo() {
    if (!projectId) { toast.error("Select a project."); return; }
    if (staged.length === 0) { toast.error("Attach at least one file."); return; }

    setSaving(true);
    let successCount = 0;
    const failedNames: string[] = [];

    for (const s of staged) {
      try {
        await upload(s.file, Number(projectId), "Other", undefined, description.trim() || undefined);
        successCount++;
      } catch {
        failedNames.push(s.file.name);
      }
    }
    staged.forEach(s => URL.revokeObjectURL(s.previewUrl));
    setSaving(false);

    if (successCount > 0) {
      toast.success(`${successCount} file(s) saved to repository.`);
      setStaged([]); setDescription("");
      setTab("repository");
    }
    if (failedNames.length > 0) toast.error(`Failed to upload: ${failedNames.join(", ")}`);
  }

  async function handleDelete(doc: ProjectDocument) {
    if (!window.confirm(`Delete "${doc.fileName}"? This removes it permanently — this cannot be undone.`)) return;
    try {
      await remove(doc.id);
      toast.success("File deleted.");
    } catch {
      toast.error("Failed to delete file.");
    }
  }

  const filtered = documents.filter(d => {
    if (projectFilter && d.projectId !== projectFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return d.fileName.toLowerCase().includes(q) || d.projectName.toLowerCase().includes(q);
  });

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
            <button style={tabStyle("repository")} onClick={()=>setTab("repository")}>Repository ({documents.length})</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto", padding:"1.25rem 1.5rem" }}>

          {tab==="upload" && (
            <>
              <input ref={fileInputRef} type="file" multiple onChange={handleFilesPicked} style={{ display:"none" }} />

              <div style={{ border:"2px dashed #e5e7eb", borderRadius:12, padding:"2rem", textAlign:"center", marginBottom:"1.25rem", cursor:"pointer", background:"#fafafa" }} onClick={()=>fileInputRef.current?.click()}>
                <Upload style={{ width:28, height:28, color:"#9ca3af", margin:"0 auto 0.625rem" }} />
                <p style={{ fontSize:"0.875rem", color:"#374151" }}>Drag &amp; drop or <span style={{ color:"#f97316", fontWeight:600, cursor:"pointer" }}>browse</span> to attach a file</p>
                <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginTop:4 }}>Any file type — max 25 MB each</p>
              </div>

              {staged.length > 0 && (
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:"1.25rem" }}>
                  {staged.map(s => (
                    <div key={s.id} style={{ display:"flex", alignItems:"center", gap:8, border:"1px solid #e5e7eb", borderRadius:8, padding:"8px 10px" }}>
                      {s.file.type.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.previewUrl} alt={s.file.name} style={{ width:36, height:36, objectFit:"cover", borderRadius:6, flexShrink:0 }} />
                      ) : (
                        <div style={{ width:36, height:36, borderRadius:6, background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          <FileIcon style={{ width:16, height:16, color:"#9ca3af" }} />
                        </div>
                      )}
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ fontSize:"0.8rem", color:"#374151", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.file.name}</p>
                        <p style={{ fontSize:"0.68rem", color:"#9ca3af" }}>{formatBytes(s.file.size)}</p>
                      </div>
                      <a href={s.previewUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize:"0.72rem", fontWeight:600, color:"#f97316", textDecoration:"none", whiteSpace:"nowrap" }}>Preview</a>
                      <button onClick={()=>removeStaged(s.id)} title="Remove" style={{ background:"none", border:"none", cursor:"pointer", color:"#ef4444", padding:4, flexShrink:0 }}>
                        <X style={{ width:14, height:14 }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display:"flex", flexDirection:"column", gap:"0.875rem" }}>
                <div>
                  <label style={lbl}>Project <span style={{ color:"#ef4444" }}>*</span></label>
                  <select value={projectId} onChange={e=>setProjectId(e.target.value ? Number(e.target.value) : "")} style={sel}>
                    <option value="">Select a project…</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div><label style={lbl}>Description / Remarks</label><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3} style={{ ...inp, resize:"vertical" as React.CSSProperties["resize"] }} placeholder="Brief description of the document contents..." suppressHydrationWarning /></div>
              </div>
            </>
          )}

          {tab==="repository" && (
            <>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem", marginBottom:"1rem" }}>
                <div style={{ position:"relative" }}>
                  <Search style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", width:14, height:14, color:"#9ca3af" }} />
                  <input value={search} onChange={e=>setSearch(e.target.value)} style={{ ...inp, paddingLeft:32 }} placeholder="Search files or projects" suppressHydrationWarning />
                </div>
                <select value={projectFilter} onChange={e=>setProjectFilter(e.target.value ? Number(e.target.value) : "")} style={{ ...inp, cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"] }}>
                  <option value="">All Projects</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:"0.75rem" }}>
                {filtered.map(doc => {
                  const cat = categoryDisplay(doc);
                  return (
                    <div key={doc.id} style={{ border:"1px solid #e5e7eb", borderRadius:10, padding:"1rem" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"0.5rem" }}>
                        <div style={{ display:"flex", gap:10, alignItems:"flex-start", minWidth:0, flex:1 }}>
                          <div style={{ width:32, height:32, borderRadius:8, background:cat.bg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                            <FolderOpen style={{ width:15, height:15, color:cat.color }} />
                          </div>
                          <div style={{ minWidth:0 }}>
                            <p style={{ fontWeight:700, fontSize:"0.875rem", color:"#111827", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{doc.fileName}</p>
                            <div style={{ display:"flex", gap:5, marginTop:4, flexWrap:"wrap" }}>
                              <span style={{ fontSize:"0.65rem", fontWeight:600, padding:"2px 8px", borderRadius:999, background:cat.bg, color:cat.color }}>{cat.label}</span>
                            </div>
                          </div>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                          <a href={`${getApiOrigin()}${doc.url}`} target="_blank" rel="noopener noreferrer" title="Preview" style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af", padding:4, display:"flex" }}>
                            <ExternalLink style={{ width:15, height:15 }} />
                          </a>
                          <button onClick={()=>handleDelete(doc)} title="Delete" style={{ background:"none", border:"none", cursor:"pointer", color:"#d1d5db", padding:4 }}>
                            <Trash2 style={{ width:15, height:15 }} />
                          </button>
                        </div>
                      </div>
                      <p style={{ fontSize:"0.72rem", color:"#6b7280", marginBottom:2 }}>{doc.projectName}</p>
                      <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginBottom:4 }}>{doc.uploadedBy} · {formatDate(doc.uploadedAt)} · {formatBytes(doc.sizeBytes)}</p>
                      {doc.description && <p style={{ fontSize:"0.72rem", color:"#6b7280" }}>{doc.description}</p>}
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
          {tab==="repository"
            ? <p style={{ fontSize:"0.78rem", color:"#9ca3af" }}>{filtered.length} of {documents.length} records</p>
            : <div />
          }
          <div style={{ display:"flex", gap:8 }}>
            {tab==="upload"
              ? <>
                  <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.82rem", cursor:"pointer" }}>Cancel</button>
                  <button onClick={saveToRepo} disabled={saving} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.82rem", fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6, opacity:saving?0.7:1 }}><Upload style={{ width:13, height:13 }} /> {saving ? "Saving…" : "Save to Repository"}</button>
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
  const [from, setFrom] = useState(new Date("2026-05-01"));
  const [to,   setTo]   = useState(new Date("2026-06-01"));
  const [fmt,  setFmt]  = useState(".PDF");
  const sel: React.CSSProperties = { ...inp, cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"] };
  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:460, boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"1rem" }}>
          <div><p style={{ fontWeight:800, fontSize:"1.05rem", color:"#111827" }}>Generate Report</p><p style={{ fontSize:"0.75rem", color:"#9ca3af", marginTop:2 }}>{project.name}</p></div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.75rem" }}>
          <div><label style={lbl}>Report Type</label><select value={type} onChange={e=>setType(e.target.value)} style={{ ...sel, width:"100%" }}>{["Material Usage","Procurement Summary","Cost Report","Excess Analytics","Forecast Report"].map(t=><option key={t}>{t}</option>)}</select></div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            <div><label style={lbl}>From</label><DatePickerField value={from} onChange={setFrom} inputStyle={{ ...inp, width:"100%", boxSizing:"border-box" as const }} /></div>
            <div><label style={lbl}>To</label><DatePickerField value={to} onChange={setTo} inputStyle={{ ...inp, width:"100%", boxSizing:"border-box" as const }} /></div>
          </div>
          <div><label style={lbl}>Format</label><select value={fmt} onChange={e=>setFmt(e.target.value)} style={{ ...sel, width:"100%" }}>{[".PDF",".CSV",".XLS"].map(f=><option key={f}>{f}</option>)}</select></div>
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={()=>{
            exportReport(fmt, { project, reportType: type, from, to });
            toast.success(`${type}${fmt} downloaded!`);
            onClose();
          }} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>Generate</button>
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
      <div style={{ background:"#fff", borderRadius:16, width:580, boxShadow:"0 20px 60px rgba(0,0,0,0.18)", overflow:"hidden", maxHeight:"90vh", display:"flex", flexDirection:"column" }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"2rem 2rem 0", flexShrink:0 }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <Activity style={{ width:18, height:18, color:"#f97316" }} />
              <p style={{ fontWeight:800, fontSize:"1.1rem", color:"#111827" }}>Progress Tracker</p>
            </div>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:3 }}>{project.name} · {project.location}</p>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto", padding:"1.5rem 2rem" }}>

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

        </div>

        {/* Footer */}
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", padding:"1.25rem 2rem", flexShrink:0, borderTop:"1px solid #f3f4f6" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>Save Update</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Delete Confirmation Modal ──────────────────────────────────────────────────

function DeleteProjectModal({ project, onClose, onConfirm, deleting }: {
  project: Project; onClose: ()=>void; onConfirm: ()=>void; deleting: boolean;
}) {
  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:420, boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:"1rem" }}>
          <div style={{ width:40, height:40, borderRadius:10, background:"#fee2e2", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Trash2 style={{ width:18, height:18, color:"#dc2626" }} />
          </div>
          <div>
            <p style={{ fontWeight:800, fontSize:"1.05rem", color:"#111827" }}>Delete Project</p>
            <p style={{ fontSize:"0.8rem", color:"#6b7280", marginTop:4 }}>
              This will permanently delete <strong>{project.name}</strong> and all of its phases, BOQ items, purchase orders, documents, and forecast data. This action cannot be undone.
            </p>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} disabled={deleting} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:deleting?"default":"pointer" }}>Cancel</button>
          <button onClick={onConfirm} disabled={deleting} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#dc2626", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:deleting?"default":"pointer", opacity:deleting?0.7:1 }}>
            {deleting ? "Deleting…" : "Delete Project"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Project Card ──────────────────────────────────────────────────────────────

function ProjectCard({ project, onView, onMaterialPlan, onReports, onProgress, onDelete, canEdit, canDelete, showProgress, viewOnly }: {
  project: Project;
  onView: ()=>void;
  onMaterialPlan: ()=>void;
  onReports: ()=>void;
  onProgress?: ()=>void;
  onDelete?: ()=>void;
  canEdit: boolean;
  canDelete: boolean;
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
            <button onClick={onView} title="View" style={{ background:"none", border:"none", cursor:"pointer", padding:0, color:"#9ca3af", display:"flex", alignItems:"center", flexShrink:0 }}>
              <Eye style={{ width:13, height:13 }} />
            </button>
          )}
          {viewOnly && (
            <span style={{ fontSize:"0.6rem", fontWeight:700, padding:"2px 7px", borderRadius:999, background:"#f3f4f6", color:"#6b7280", flexShrink:0 }}>VIEW ONLY</span>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <span style={{ fontSize:"0.65rem", fontWeight:700, padding:"3px 10px", borderRadius:999, background:st.bg, color:st.color, whiteSpace:"nowrap" }}>· {project.status}</span>
          {canDelete && (
            <button onClick={onDelete} title="Delete project" style={{ background:"none", border:"none", cursor:"pointer", padding:0, color:"#d1d5db", display:"flex", alignItems:"center" }}>
              <Trash2 style={{ width:14, height:14 }} />
            </button>
          )}
        </div>
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
        <button onClick={onMaterialPlan} style={btn}><FileText style={{ width:13, height:13 }} /> Material Plan</button>
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
  | { type:"newProject" }
  | { type:"addCompletedProject" }
  | { type:"workspace"; projectId:number; editable:boolean }
  | { type:"reports"; project:Project }
  | { type:"forecast"; project:Project }
  | { type:"repository" }
  | { type:"progress"; project:Project }
  | { type:"deleteConfirm"; project:Project }
  | null;

export default function ProjectsPage() {
  const [projects,     setProjects]     = useState<Project[]>(INIT_PROJECTS);
  const [fullProjects, setFullProjects] = useState<RealProject[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState<ModalState>(null);
  const [deleting, setDeleting] = useState(false);
  const { user } = useAuthStore();
  const role = user?.role ?? "SiteEngineer";

  // Role-based permissions
  const canCreate    = role === "Admin" || role === "ProjectManager";
  const canEdit      = role === "Admin" || role === "ProjectManager" || role === "SiteEngineer";
  const canDelete    = role === "Admin";
  const showProgress = role === "Admin" || role === "ProjectManager" || role === "SiteEngineer";
  const viewOnly     = role === "ProcurementOfficer";

  async function handleDeleteProject(id: number) {
    setDeleting(true);
    try {
      await api.delete(`/projects/${id}`);
      setProjects(prev => prev.filter(p => p.id !== id));
      setFullProjects(prev => prev.filter(p => p.id !== id));
      toast.success("Project deleted.");
      setModal(null);
    } catch {
      toast.error("Failed to delete project.");
    } finally {
      setDeleting(false);
    }
  }

  function refreshProjects() {
    return api.get<ProjectResponseDto[]>("/projects")
      .then(r => {
        setProjects(r.data.map(toProject));
        setFullProjects(r.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { refreshProjects(); }, []);

  const proj = modal && "project" in modal ? modal.project : undefined;
  const workspaceProject = modal?.type === "workspace" ? fullProjects.find(p => p.id === modal.projectId) : undefined;

  return (
    <div style={{ background:"#f5f4f0", minHeight:"100vh" }}>
      {modal?.type==="newProject" && (
        <NewProjectWizardModal
          onClose={()=>setModal(null)}
          onDone={()=>{ setModal(null); refreshProjects(); }}
        />
      )}
      {modal?.type==="addCompletedProject" && (
        <AddCompletedProjectWizardModal
          onClose={()=>setModal(null)}
          onDone={()=>{ setModal(null); refreshProjects(); }}
        />
      )}
      {modal?.type==="workspace" && workspaceProject && (
        <MeasurementsAndMaterialPlan
          project={workspaceProject}
          initialEditable={modal.editable}
          onClose={()=>setModal(null)}
          onProjectSaved={(updated)=>setFullProjects(prev=>prev.map(p=>p.id===updated.id?updated:p))}
        />
      )}
      {modal?.type==="reports"      && proj && <ReportsModal project={proj} onClose={()=>setModal(null)} />}
      {modal?.type==="forecast"     && proj && <ForecastModal project={proj} onClose={()=>setModal(null)} />}
      {modal?.type==="repository"   && <FileRepositoryModal onClose={()=>setModal(null)} projects={fullProjects} />}
      {modal?.type==="deleteConfirm" && (
        <DeleteProjectModal
          project={modal.project}
          deleting={deleting}
          onClose={()=>setModal(null)}
          onConfirm={()=>handleDeleteProject(modal.project.id)}
        />
      )}
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
              <button onClick={()=>setModal({type:"addCompletedProject"})} style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 18px", borderRadius:10, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", fontWeight:600, cursor:"pointer" }} title="Backfill a finished project as historical data for the forecasting model">
                <History style={{ width:14, height:14 }} /> Add Completed Project
              </button>
            )}
            {canCreate && (
              <button onClick={()=>setModal({type:"newProject"})} style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 20px", borderRadius:10, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>
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
                onView={()=>setModal({type:"workspace",projectId:p.id,editable:false})}
                onMaterialPlan={()=>setModal({type:"workspace",projectId:p.id,editable:true})}
                onReports={()=>setModal({type:"reports",project:p})}
                onProgress={()=>setModal({type:"progress",project:p})}
                onDelete={()=>setModal({type:"deleteConfirm",project:p})}
                canEdit={canEdit}
                canDelete={canDelete}
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
