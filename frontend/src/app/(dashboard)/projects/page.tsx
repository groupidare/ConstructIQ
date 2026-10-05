"use client";

import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import api from "@/lib/api";
import Header from "@/components/layout/Header";
import { useAuthStore } from "@/store/authStore";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { exportReport } from "@/lib/reportExport";
import { buildReportTable } from "@/lib/reportTables";
import MeasurementsAndMaterialPlan from "@/components/projects/MeasurementsAndMaterialPlan";
import NewProjectWizardModal from "@/components/projects/NewProjectWizardModal";
import AddCompletedProjectWizardModal from "@/components/projects/AddCompletedProjectWizardModal";
import { useDocumentRepository } from "@/hooks/useDocumentRepository";
import { useSiteEngineers } from "@/hooks/useSiteEngineers";
import { resolveUploadUrl } from "@/lib/avatar";
import { formatDate } from "@/lib/utils";
import type { Project as RealProject, ProjectType } from "@/types/project";
import { PROJECT_TYPES, PROJECT_STATUSES } from "@/types/project";
import type { ProjectDocument } from "@/types/document";
import type { BOQItem } from "@/types/boq";
import { topMaterialDemand } from "@/lib/topMaterialDemand";
import type { ExcessWasteRecord } from "@/types/excess";
import type { ExcessAnalyticsSummary } from "@/types/excess";
import type { RedistributionRecommendation } from "@/types/procurement";
import type { PurchaseOrder } from "@/types/purchaseOrder";
import type { ForecastResult, ForecastedMaterial } from "@/types/forecast";
import {
  Plus, MapPin, Calendar, Users, FileText, X, Eye, Pencil,
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
  manager: string; engineers: string[];
  type: string;
  isHistorical: boolean;
  siteEngineerId?: number;
}


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
  return {
    id: dto.id, name: dto.name, location: dto.location, type: dto.type,
    startDate: dto.startDate.split("T")[0], endDate: dto.targetEndDate.split("T")[0],
    status, progress: dto.progress,
    progressColor: PROGRESS_COLOR[status] ?? "#374151",
    manager: dto.projectManagerName,
    // A SiteEngineer-created project attributes both slots to its creator
    // (see ProjectService.CreateAsync) — don't show their name twice.
    engineers: dto.siteEngineerName && dto.siteEngineerName !== dto.projectManagerName ? [dto.siteEngineerName] : [],
    isHistorical: dto.isHistorical,
    siteEngineerId: dto.siteEngineerId,
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
                          <a href={resolveUploadUrl(doc.url) ?? "#"} target="_blank" rel="noopener noreferrer" title="Preview" style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af", padding:4, display:"flex" }}>
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
  // Relative to "now" (not a fixed date) so this default never goes stale —
  // a hardcoded past range meant every report silently came back empty once
  // enough time had passed, unless the user thought to change the dates first.
  const [from, setFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d; });
  const [to,   setTo]   = useState(() => new Date());
  const [fmt,  setFmt]  = useState(".PDF");
  const [generating, setGenerating] = useState(false);
  const sel: React.CSSProperties = { ...inp, cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"] };

  async function handleGenerate() {
    setGenerating(true);
    try {
      // Pulls whichever real, already-tracked dataset backs the selected
      // report type — never hardcoded content, see lib/reportTables.ts.
      let table;
      if (type === "Procurement Summary") {
        const { data } = await api.get<PurchaseOrder[]>("/purchase-orders", { params: { projectId: project.id } });
        table = buildReportTable(type, { purchaseOrders: data }, from, to);
      } else if (type === "Excess Analytics") {
        const { data } = await api.get<ExcessWasteRecord[]>(`/excess-waste/project/${project.id}`);
        table = buildReportTable(type, { excessRecords: data }, from, to);
      } else if (type === "Forecast Report") {
        const { data } = await api.get<ForecastResult[]>(`/forecast/project/${project.id}`);
        table = buildReportTable(type, { forecastResults: data }, from, to);
      } else {
        const { data } = await api.get<BOQItem[]>(`/boq/project/${project.id}`);
        table = buildReportTable(type, { boqItems: data }, from, to);
      }

      exportReport(fmt, { project: { name: project.name, location: project.location }, reportType: type, from, to, table });
      toast.success(`${type}${fmt} downloaded!`);
      onClose();
    } catch {
      toast.error("Failed to generate report — couldn't load the project's data.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:460, boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"1rem" }}>
          <div><p style={{ fontWeight:800, fontSize:"1.05rem", color:"#111827" }}>Generate Report</p><p style={{ fontSize:"0.75rem", color:"#9ca3af", marginTop:2 }}>{project.name}</p></div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.75rem" }}>
          <div><label style={lbl}>Report Type</label><select value={type} onChange={e=>setType(e.target.value)} style={{ ...sel, width:"100%" }}>{["Material Usage","Procurement Summary","Excess Analytics","Forecast Report"].map(t=><option key={t}>{t}</option>)}</select></div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            <div><label style={lbl}>From</label><DatePickerField value={from} onChange={setFrom} inputStyle={{ ...inp, width:"100%", boxSizing:"border-box" as const }} /></div>
            <div><label style={lbl}>To</label><DatePickerField value={to} onChange={setTo} inputStyle={{ ...inp, width:"100%", boxSizing:"border-box" as const }} /></div>
          </div>
          <div><label style={lbl}>Format</label><select value={fmt} onChange={e=>setFmt(e.target.value)} style={{ ...sel, width:"100%" }}>{[".PDF",".CSV",".XLS"].map(f=><option key={f}>{f}</option>)}</select></div>
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor: generating ? "not-allowed" : "pointer", opacity: generating ? 0.7 : 1 }}
          >{generating ? "Generating…" : "Generate"}</button>
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

interface ProgressUpdateDto {
  id: number; progress: number; notes: string;
  photoUrls: string[]; updatedByName: string; createdAt: string;
}

function ProgressTrackerModal({ project, onClose, onSaved }: {
  project: Project;
  onClose: ()=>void;
  onSaved: (updated: RealProject) => void;
}) {
  const [progress, setProgress] = useState(project.progress);
  const [notes, setNotes]       = useState("");
  const [photos, setPhotos]     = useState<File[]>([]);
  const [saving, setSaving]     = useState(false);
  const [updates, setUpdates]   = useState<ProgressUpdateDto[]>([]);
  // Primary Sections from the project's own BOQ — replaces the old hardcoded
  // 4-phase list so "section status" actually reflects what's being built.
  const [sections, setSections] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.get<BOQItem[]>(`/boq/project/${project.id}`).then(({ data }) => {
      if (cancelled) return;
      const seen: string[] = [];
      data.forEach(item => { if (item.primarySection && !seen.includes(item.primarySection)) seen.push(item.primarySection); });
      setSections(seen);
    }).catch(() => {});
    api.get<ProgressUpdateDto[]>(`/projects/${project.id}/progress-updates`)
      .then(({ data }) => { if (!cancelled) setUpdates(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [project.id]);

  async function handleSave() {
    if (!notes.trim()) { toast.error("Please add progress notes before saving."); return; }
    setSaving(true);
    try {
      const form = new FormData();
      form.append("Progress", String(progress));
      form.append("Notes", notes);
      photos.forEach(f => form.append("Photos", f));
      const { data } = await api.post<{ project: RealProject; update: ProgressUpdateDto }>(
        `/projects/${project.id}/progress-updates`, form, { headers: { "Content-Type": undefined } },
      );
      setUpdates(prev => [data.update, ...prev]);
      if (data.project.isHistorical && !project.isHistorical) {
        toast.success("Progress updated — project completed and moved to Historical Data!");
      } else if (data.project.status === "Active" && project.status !== "ACTIVE") {
        toast.success("Progress updated — project is now Active!");
      } else {
        toast.success("Progress updated successfully!");
      }
      onSaved(data.project);
    } catch {
      toast.error("Failed to save progress update.");
    } finally {
      setSaving(false);
    }
  }

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

        {/* Section status — every Primary Section from this project's own BOQ,
            not a generic hardcoded phase list. Done/in-progress/pending is
            derived by splitting 0-100 evenly across however many sections
            the BOQ actually has. */}
        <div style={{ marginBottom:"1.25rem" }}>
          <p style={{ fontSize:"0.78rem", fontWeight:700, color:"#374151", marginBottom:8 }}>Section Status</p>
          {sections.length === 0 ? (
            <p style={{ fontSize:"0.75rem", color:"#9ca3af", padding:"0.5rem 0" }}>
              No BOQ sections yet — add materials in the Material Plan tab first.
            </p>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {sections.map((section, i) => {
                const threshold     = ((i + 1) / sections.length) * 100;
                const prevThreshold = (i / sections.length) * 100;
                const done   = progress >= threshold;
                const inProg = !done && progress >= prevThreshold;
                return (
                  <div
                    key={section}
                    // Math.ceil, not round — rounding down could land a hair
                    // under the exact (unrounded) threshold this same section
                    // checks against below, showing "In Progress" instead of
                    // "Done" right after clicking to mark it done.
                    onClick={() => setProgress(Math.ceil(threshold))}
                    title={`Mark "${section}" as done — sets Overall Progress to ${Math.ceil(threshold)}%`}
                    style={{
                      display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
                      background: done ? "#dcfce7" : inProg ? "#fff7ed" : "#f9fafb",
                      borderRadius:8, cursor:"pointer",
                      border: `1px solid ${done ? "#86efac" : inProg ? "#fed7aa" : "#e5e7eb"}`,
                    }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", flexShrink:0,
                      background: done ? "#22c55e" : inProg ? "#f97316" : "#d1d5db" }} />
                    <span style={{ fontSize:"0.75rem", fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                      color: done ? "#15803d" : inProg ? "#c2410c" : "#9ca3af" }}>{section}</span>
                    <span style={{ fontSize:"0.65rem", color:"#9ca3af", marginLeft:"auto", flexShrink:0 }}>
                      {done ? "Done" : inProg ? "In Progress" : "Pending"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
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
                    <span style={{ fontSize:"0.68rem", color:"#9ca3af" }}>{formatDate(u.createdAt)}</span>
                  </div>
                  <p style={{ fontSize:"0.75rem", color:"#374151", lineHeight:1.4 }}>{u.notes}</p>
                  <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginTop:3 }}>
                    Updated by {u.updatedByName}{u.photoUrls.length > 0 ? ` · ${u.photoUrls.length} photo(s)` : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        </div>

        {/* Footer */}
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", padding:"1.25rem 2rem", flexShrink:0, borderTop:"1px solid #f3f4f6" }}>
          <button onClick={onClose} disabled={saving} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:saving?"default":"pointer" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:saving?"default":"pointer", opacity:saving?0.7:1 }}>
            {saving ? "Saving…" : "Save Update"}
          </button>
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

// ── Edit Project Details Modal ─────────────────────────────────────────────────

function EditProjectModal({ project, onClose, onSaved }: {
  project: RealProject; onClose: ()=>void; onSaved: (p: RealProject)=>void;
}) {
  const [name, setName]               = useState(project.name);
  const [type, setType]               = useState<ProjectType>(project.type);
  const [otherType, setOtherType]     = useState(project.otherTypeSpecify ?? "");
  const [location, setLocation]       = useState(project.location);
  const [description, setDescription] = useState(project.description ?? "");
  const [startDate, setStartDate]     = useState(new Date(project.startDate));
  const [endDate, setEndDate]         = useState(new Date(project.targetEndDate));
  const [status, setStatus]           = useState(project.status);
  const [siteEngineerId, setSiteEngineerId] = useState<number | "">(project.siteEngineerId ?? "");
  const [saving, setSaving]           = useState(false);
  const { siteEngineers } = useSiteEngineers();

  const sel: React.CSSProperties = { ...inp, cursor:"pointer", appearance:"none" as React.CSSProperties["appearance"] };

  async function handleSave() {
    if (!name.trim() || !location.trim()) { toast.error("Name and location are required."); return; }
    setSaving(true);
    try {
      const { data } = await api.put<RealProject>(`/projects/${project.id}`, {
        name: name.trim(),
        type,
        otherTypeSpecify: type === "Others" ? otherType.trim() : undefined,
        location: location.trim(),
        description: description.trim() || undefined,
        budget: project.budget,
        startDate: startDate.toISOString(),
        targetEndDate: endDate.toISOString(),
        status,
        siteEngineerId: siteEngineerId === "" ? undefined : siteEngineerId,
        phases: [],
      });
      toast.success("Project details updated.");
      onSaved(data);
      onClose();
    } catch {
      toast.error("Failed to update project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:520, boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"1rem" }}>
          <div><p style={{ fontWeight:800, fontSize:"1.05rem", color:"#111827" }}>Edit Project Details</p><p style={{ fontSize:"0.75rem", color:"#9ca3af", marginTop:2 }}>{project.name}</p></div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:20, height:20 }} /></button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.875rem", maxHeight:"60vh", overflowY:"auto", paddingRight:4 }}>
          <div><label style={lbl}>Project Name</label><input value={name} onChange={e=>setName(e.target.value)} style={inp} /></div>
          <div style={{ display:"grid", gridTemplateColumns: type==="Others" ? "1fr 1fr" : "1fr", gap:"0.75rem" }}>
            <div>
              <label style={lbl}>Project Type</label>
              <select value={type} onChange={e=>setType(e.target.value as ProjectType)} style={sel}>
                {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {type === "Others" && (
              <div><label style={lbl}>Specify Type</label><input value={otherType} onChange={e=>setOtherType(e.target.value)} style={inp} /></div>
            )}
          </div>
          <div><label style={lbl}>Location</label><input value={location} onChange={e=>setLocation(e.target.value)} style={inp} /></div>
          <div><label style={lbl}>Description</label><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3} style={{ ...inp, resize:"vertical" as const }} /></div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            <div><label style={lbl}>Start Date</label><DatePickerField value={startDate} onChange={setStartDate} inputStyle={{ ...inp, width:"100%", boxSizing:"border-box" as const }} /></div>
            <div><label style={lbl}>Target End Date</label><DatePickerField value={endDate} onChange={setEndDate} inputStyle={{ ...inp, width:"100%", boxSizing:"border-box" as const }} /></div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            <div>
              <label style={lbl}>Status</label>
              <select value={status} onChange={e=>setStatus(e.target.value as typeof status)} style={sel}>
                {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Assign Engineer/PIC</label>
              <select value={siteEngineerId} onChange={e=>setSiteEngineerId(e.target.value === "" ? "" : Number(e.target.value))} style={sel}>
                <option value="">— Unassigned —</option>
                {/* The currently-assigned engineer might have since been
                    deactivated (dropped from the active list below) — keep
                    them selectable so re-saving this form without touching
                    the field doesn't silently unassign them. */}
                {project.siteEngineerId != null && !siteEngineers.some(e => e.id === project.siteEngineerId) && (
                  <option value={project.siteEngineerId}>{project.siteEngineerName} (inactive)</option>
                )}
                {siteEngineers.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} disabled={saving} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:saving?"default":"pointer" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontWeight:700, fontSize:"0.875rem", cursor:saving?"default":"pointer", opacity:saving?0.7:1 }}>{saving?"Saving…":"Save Changes"}</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Project Card ──────────────────────────────────────────────────────────────

function ProjectCard({ project, refreshKey, onView, onMaterialPlan, onReports, onProgress, onDelete, onEditDetails, canEdit, canDelete, canEditDetails, showProgress, viewOnly }: {
  project: Project;
  // Bumped by the parent whenever a Material Plan session closes (for any
  // project) — this card doesn't otherwise know a forecast/BOQ save
  // happened while its modal was open, since project.id/status don't change.
  refreshKey: number;
  onView: ()=>void;
  onMaterialPlan: ()=>void;
  onReports: ()=>void;
  onProgress?: ()=>void;
  onDelete?: ()=>void;
  onEditDetails?: ()=>void;
  canEdit: boolean;
  canDelete: boolean;
  canEditDetails: boolean;
  showProgress: boolean;
  viewOnly: boolean;
}) {
  const st = STATUS_STYLE[project.status];
  const btn: React.CSSProperties = { flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6, padding:"10px 0", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.8rem", fontWeight:600, cursor:"pointer" };

  // actual is undefined when this specific line never got a real recorded
  // quantity (neither a historicalSupply delivery nor BOQItem.ActualQuantity)
  // — shown as "—" rather than silently standing in for the estimate, so a
  // viewer can tell forecast-validation signal from filler at a glance.
  // Genuine ML output from the project's latest saved forecast run (GET
  // /forecast/project/:id, newest first) — never the historical-average
  // heuristic (topMaterialDemand), which has never been touched by the ML
  // pipeline despite ranking similarly. Empty when no forecast has been run
  // yet for this project; never silently substituted with something else.
  const [aiPredicted, setAiPredicted] = useState<ForecastedMaterial[]>([]);
  const [topDemand, setTopDemand]     = useState<{ material:string; estimated:number; actual?:number; unit:string }[]>([]);
  const [excessStock, setExcessStock]     = useState(0);
  const [redistributed, setRedistributed] = useState(0);
  const [materialsCount, setMaterialsCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.get<ExcessAnalyticsSummary>(`/excess-waste/summary/${project.id}`)
      .then(({ data }) => { if (!cancelled) setExcessStock(data.totalExcessQuantity); })
      .catch(() => {});
    api.get<RedistributionRecommendation[]>("/redistribution")
      .then(({ data }) => {
        if (cancelled) return;
        // Approved is the sole terminal state for a redistribution transfer —
        // InTransit/Completed are never set by any code (see RedistributionStatuses).
        const total = data
          .filter(r => r.status === "Approved" && (r.sourceProjectId === project.id || r.targetProjectId === project.id))
          .reduce((sum, r) => sum + r.transferQuantity, 0);
        setRedistributed(total);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [project.id, refreshKey]);

  useEffect(() => {
    let cancelled = false;

    // Real materials count, fetched once and reused below instead of
    // relying on a hardcoded demo fallback that was always 0 for any
    // project outside the original 5 mock entries.
    Promise.all([
      api.get<BOQItem[]>(`/boq/project/${project.id}`),
      api.get<ExcessWasteRecord[]>(`/excess-waste/project/${project.id}`),
    ])
      .then(([{ data: boqItems }, { data: records }]) => {
        if (cancelled) return;
        setMaterialsCount(boqItems.length);
        // Historical projects are training data, not a forecast target
        // themselves (see Material Plan's "Materials by Demand" panel) —
        // ranked by real recorded demand instead of a forecast. Ranking/
        // grouping lives in topMaterialDemand (lib/topMaterialDemand.ts):
        // groups BOQ rows by materialId+specification+unit, and only trusts
        // a row's ActualQuantity as real "actual usage" when a genuine
        // ExcessWasteRecord was logged against it (recordedIds) — otherwise
        // it's undefined ("—" in the UI), never silently substituted with
        // the estimate.
        if (project.isHistorical) {
          const recordedIds = new Set(records.flatMap(r => r.boqItemId == null ? [] : [r.boqItemId]));
          setTopDemand(topMaterialDemand(boqItems, project.isHistorical, recordedIds));
        }
      })
      .catch(() => {});

    // Non-historical ("AI Predicted") comes from this project's own latest
    // saved forecast run — genuine Random Forest + XGBoost ensemble output,
    // never the historical-average heuristic above (which, despite ranking
    // similarly, has never been touched by the ML pipeline). Empty when no
    // forecast has been generated for this project yet.
    if (!project.isHistorical) {
      api.get<ForecastResult[]>(`/forecast/project/${project.id}`)
        .then(({ data }) => {
          if (cancelled) return;
          const latest = data[0];
          const top5 = (latest?.forecastedMaterials ?? [])
            .slice()
            .sort((a, b) => b.forecastedQuantity - a.forecastedQuantity)
            .slice(0, 5);
          setAiPredicted(top5);
        })
        .catch(() => {});
    }

    return () => { cancelled = true; };
  }, [project.id, project.status, project.isHistorical, refreshKey]);

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
          {canEditDetails && (
            <button onClick={onEditDetails} title="Edit project details" style={{ background:"none", border:"none", cursor:"pointer", padding:0, color:"#9ca3af", display:"flex", alignItems:"center", flexShrink:0 }}>
              <Pencil style={{ width:13, height:13 }} />
            </button>
          )}
          {viewOnly && (
            <span style={{ fontSize:"0.6rem", fontWeight:700, padding:"2px 7px", borderRadius:999, background:"#f3f4f6", color:"#6b7280", flexShrink:0 }}>VIEW ONLY</span>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          {project.isHistorical ? (
            <span style={{ fontSize:"0.65rem", fontWeight:700, padding:"3px 10px", borderRadius:999, background:"#ede9fe", color:"#6d28d9", whiteSpace:"nowrap" }}>HISTORICAL DATA</span>
          ) : (
            <span style={{ fontSize:"0.65rem", fontWeight:700, padding:"3px 10px", borderRadius:999, background:st.bg, color:st.color, whiteSpace:"nowrap" }}>· {project.status}</span>
          )}
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

      {/* AI forecast summary */}
      <div style={{ display:"flex", flexDirection:"column", gap:2, marginBottom:"0.75rem" }}>
        {project.isHistorical ? (
          topDemand.length === 0 ? (
            <span style={{ fontSize:"0.7rem", fontWeight:600, color:"#6d28d9" }}>Most Material Demand/Usage: —</span>
          ) : (
            <>
              <span style={{ fontSize:"0.65rem", fontWeight:700, color:"#6d28d9", marginBottom: 1 }}>Top 5 Material Demand/Usage</span>
              {topDemand.map((m, i) => (
                <span key={i} style={{ fontSize:"0.68rem", fontWeight:500, color:"#6d28d9" }}>
                  {i + 1}. {m.material} - Est: {m.estimated.toLocaleString()} {m.unit} / Actual: {m.actual != null ? `${m.actual.toLocaleString()} ${m.unit}` : "—"}
                </span>
              ))}
            </>
          )
        ) : (
          <>
            {aiPredicted.length === 0 ? (
              <span style={{ fontSize:"0.7rem", fontWeight:600, color:"#7c3aed" }}>AI Predicted: — (no forecast run yet)</span>
            ) : (
              <>
                <span style={{ fontSize:"0.65rem", fontWeight:700, color:"#7c3aed", marginBottom: 1 }}>Top 5 AI Predicted</span>
                {aiPredicted.map((m, i) => (
                  <span key={i} style={{ fontSize:"0.68rem", fontWeight:500, color:"#7c3aed" }}>
                    {i + 1}. {m.materialName} - Forecast: {m.forecastedQuantity.toLocaleString()} {m.unit}
                  </span>
                ))}
              </>
            )}
          </>
        )}
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
        {[["Excess Stock",`${excessStock.toLocaleString()} units`],["Redistributed",`${redistributed.toLocaleString()} units`],["Materials",`${materialsCount} items`]].map(([l,v])=>(
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
  | { type:"editProject"; fullProject:RealProject }
  | null;

export default function ProjectsPage() {
  const [projects,     setProjects]     = useState<Project[]>([]);
  const [fullProjects, setFullProjects] = useState<RealProject[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [modal,    setModal]    = useState<ModalState>(null);
  const [deleting, setDeleting] = useState(false);
  // "Projects" = every real project tracked through the app (any status,
  // reached via the Progress Tracker). "Historical Data" = pure backfilled
  // records entered only to train the forecasting model — not real projects.
  const [view, setView] = useState<"projects" | "historical">("projects");
  const [projectSearch, setProjectSearch] = useState("");
  // Bumped whenever a Material Plan session closes, so cards refetch their
  // forecast/BOQ-derived summaries (see ProjectCard's refreshKey prop).
  const [refreshKey, setRefreshKey] = useState(0);
  const { user } = useAuthStore();
  const role = user?.role ?? "SiteEngineer";

  // Role-based permissions
  const canCreate    = role === "Admin" || role === "ProjectManager" || role === "SiteEngineer";
  const canEdit      = role === "Admin" || role === "ProjectManager" || role === "SiteEngineer";
  const canDelete    = role === "Admin";
  const showProgress = role === "Admin" || role === "ProjectManager" || role === "SiteEngineer";
  const viewOnly     = role === "ProcurementOfficer";

  // A SiteEngineer can only edit the project they're assigned to (mirrors
  // the backend's ProjectAccessService) — every other role's edit rights are
  // all-or-nothing, so this only needs to branch for SiteEngineer.
  function canEditProject(p: Project): boolean {
    if (role === "Admin" || role === "ProjectManager") return true;
    if (role === "SiteEngineer") return p.siteEngineerId === user?.id;
    return false;
  }

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
        setLoadError(false);
      })
      .catch(() => {
        // Leave whatever was last successfully loaded on screen (if
        // anything) rather than silently swallowing the failure — a stale
        // or empty list looks identical to "no projects yet" otherwise.
        setLoadError(true);
        toast.error("Failed to load projects — check that the server is reachable.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { refreshProjects(); }, []);

  const proj = modal && "project" in modal ? modal.project : undefined;
  const workspaceProject = modal?.type === "workspace" ? fullProjects.find(p => p.id === modal.projectId) : undefined;
  const realProjects       = projects.filter(p => !p.isHistorical);
  // Historical Data only, newest project first — startDate is a plain
  // "YYYY-MM-DD" string (see toProject below), so lexicographic order is
  // already chronological order; Projects (live/planned work) is left in
  // whatever order the API returns, unaffected.
  const historicalProjects = projects.filter(p => p.isHistorical)
    .slice().sort((a, b) => b.startDate.localeCompare(a.startDate));
  const searchQuery        = projectSearch.trim().toLowerCase();
  // Tab badges/summary text above still reflect the full, unfiltered counts —
  // only the grid itself narrows down to what matches the search.
  const visibleProjects    = (view === "historical" ? historicalProjects : realProjects)
    .filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery));

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
          onClose={()=>{ setModal(null); setRefreshKey(k=>k+1); }}
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
          onSaved={(updated) => {
            setFullProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
            setProjects(prev => prev.map(p => p.id === updated.id ? toProject(updated) : p));
            setModal(null);
          }}
        />
      )}
      {modal?.type==="editProject" && (
        <EditProjectModal
          project={modal.fullProject}
          onClose={()=>setModal(null)}
          onSaved={(updated) => {
            setFullProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
            setProjects(prev => prev.map(p => p.id === updated.id ? toProject(updated) : p));
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
              {loading ? "Loading…" : view === "historical"
                ? `${historicalProjects.length} historical record(s) — training data for the forecasting model`
                : `${realProjects.length} projects · ${realProjects.filter(p=>p.status==="ACTIVE").length} active`}
            </p>
          </div>
          <div style={{ display:"flex", gap:"0.625rem" }}>
            {canCreate && (
              <button suppressHydrationWarning onClick={()=>setModal({type:"repository"})} style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 18px", borderRadius:10, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", fontWeight:600, cursor:"pointer" }}>
                <Upload style={{ width:14, height:14 }} /> Import Files
              </button>
            )}
            {canCreate && (
              <button suppressHydrationWarning onClick={()=>setModal({type:"addCompletedProject"})} style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 18px", borderRadius:10, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", fontWeight:600, cursor:"pointer" }} title="Backfill a finished project as historical data for the forecasting model">
                <History style={{ width:14, height:14 }} /> Add Completed Project
              </button>
            )}
            {canCreate && (
              <button suppressHydrationWarning onClick={()=>setModal({type:"newProject"})} style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 20px", borderRadius:10, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>
                <Plus style={{ width:15, height:15 }} /> New Project
              </button>
            )}
          </div>
        </div>

        {/* Projects vs. Historical Data tabs — search applies to whichever is active */}
        <div style={{ display:"flex", flexWrap:"wrap", justifyContent:"space-between", alignItems:"center", gap:"0.75rem", borderBottom:"1px solid #e5e7eb", marginBottom:"1.25rem" }}>
          <div style={{ display:"flex" }}>
            <button
              suppressHydrationWarning
              onClick={()=>setView("projects")}
              style={{ padding:"10px 18px", border:"none", cursor:"pointer", fontSize:"0.875rem", background:"transparent",
                fontWeight: view==="projects" ? 700 : 400, color: view==="projects" ? "#f97316" : "#9ca3af",
                borderBottom: view==="projects" ? "2px solid #f97316" : "2px solid transparent" }}
            >
              Projects ({realProjects.length})
            </button>
            <button
              suppressHydrationWarning
              onClick={()=>setView("historical")}
              style={{ padding:"10px 18px", border:"none", cursor:"pointer", fontSize:"0.875rem", background:"transparent",
                fontWeight: view==="historical" ? 700 : 400, color: view==="historical" ? "#f97316" : "#9ca3af",
                borderBottom: view==="historical" ? "2px solid #f97316" : "2px solid transparent" }}
            >
              Historical Data ({historicalProjects.length})
            </button>
          </div>
          <div style={{ position:"relative", width:260, maxWidth:"100%", marginBottom:8 }}>
            <Search style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", width:14, height:14, color:"#9ca3af", pointerEvents:"none" }} />
            <input
              suppressHydrationWarning
              value={projectSearch}
              onChange={e=>setProjectSearch(e.target.value)}
              placeholder="Search project name..."
              style={{ width:"100%", boxSizing:"border-box", paddingLeft:32, paddingRight:10, paddingTop:8, paddingBottom:8, borderRadius:8, background:"#fff", border:"1px solid #e5e7eb", fontSize:"0.82rem", outline:"none", color:"#111827" }}
            />
          </div>
        </div>

        {/* Project grid */}
        {loading ? (
          <div style={{ padding:"3rem", textAlign:"center", color:"#9ca3af" }}>Loading projects…</div>
        ) : loadError && visibleProjects.length === 0 ? (
          <div style={{ padding:"3rem", textAlign:"center", color:"#ef4444" }}>
            Couldn&apos;t reach the server — projects failed to load. Check your connection and try refreshing.
          </div>
        ) : visibleProjects.length === 0 ? (
          <div style={{ padding:"3rem", textAlign:"center", color:"#9ca3af" }}>
            {searchQuery
              ? `No ${view === "historical" ? "historical records" : "projects"} match "${projectSearch.trim()}".`
              : view === "historical" ? "No historical records yet. Click \"Add Completed Project\" to backfill one." : "No projects yet. Click \"+ New Project\" to get started."}
          </div>
        ) : (
          // minmax(0, 1fr), not bare 1fr — a plain 1fr column has an implicit
          // min size of "auto" (its content's min-content width), so a long
          // project name/location could still force this grid wider than the
          // viewport even with the flex-container fix in the dashboard layout.
          <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:"1rem" }}>
            {visibleProjects.map(p => (
              <ProjectCard
                key={p.id}
                project={p}
                refreshKey={refreshKey}
                onView={()=>setModal({type:"workspace",projectId:p.id,editable:false})}
                onMaterialPlan={()=>setModal({type:"workspace",projectId:p.id,editable:canEditProject(p)})}
                onReports={()=>setModal({type:"reports",project:p})}
                onProgress={()=>setModal({type:"progress",project:p})}
                onDelete={()=>setModal({type:"deleteConfirm",project:p})}
                onEditDetails={()=>{
                  const full = fullProjects.find(fp => fp.id === p.id);
                  if (full) setModal({type:"editProject", fullProject: full});
                }}
                canEdit={canEdit}
                canDelete={canDelete}
                canEditDetails={canEditProject(p)}
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
