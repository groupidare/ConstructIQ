"use client";

import { Fragment, useMemo, useState, useEffect } from "react";
import Header from "@/components/layout/Header";
import { useProjects } from "@/hooks/useProjects";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { ExcessWasteRecord } from "@/types/excess";
import RedistributeModal from "@/components/excess/RedistributeModal";
import RecordExcessModal from "@/components/excess/RecordExcessModal";
import EditExcessModal from "@/components/excess/EditExcessModal";
import {
  Trash2, Monitor, Package,
  TrendingUp, FileText, Plus, Search, Recycle, ChevronDown, ChevronRight, Pencil,
} from "lucide-react";

// ── Static data (Overview tab only — see note below) ─────────────────────────

const CHART_DATA = [
  { project: "Metro Station Phase 3",   rate: 6.2 },
  { project: "BGC Tower Complex",       rate: 3.1 },
  { project: "Harbor Bridge Renovation",rate: 7.1 },
  { project: "Southgate Mall Expansion",rate: 4.8 },
  { project: "PUP ICTC Building",       rate: 2.3 },
  { project: "ICTC HALL",               rate: 3.6 },
  { project: "PUP North Wing",          rate: 5.4 },
  { project: "Group 11 House",          rate: 2.9 },
];

const MAX_RATE = Math.max(...CHART_DATA.map(d => d.rate));

const EXCESS_TYPE_STYLE: Record<string, { bg: string; color: string }> = {
  Unused:      { bg: "#fef3c7", color: "#b45309" },
  Overordered: { bg: "#fef3c7", color: "#b45309" },
  Damaged:     { bg: "#fee2e2", color: "#dc2626" },
  Expired:     { bg: "#fee2e2", color: "#dc2626" },
};

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "overview" | "log";

export default function ExcessAnalyticsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [logSearch, setLogSearch] = useState("");

  const { projects } = useProjects();
  const [records, setRecords] = useState<ExcessWasteRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [redistributeTarget, setRedistributeTarget] = useState<ExcessWasteRecord | null>(null);
  const [editTarget, setEditTarget] = useState<ExcessWasteRecord | null>(null);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [expandedProjectId, setExpandedProjectId] = useState<number | null>(null);

  async function loadRecords() {
    if (projects.length === 0) return;
    setRecordsLoading(true);
    try {
      const results = await Promise.all(
        projects.map(p => api.get<ExcessWasteRecord[]>(`/excess-waste/project/${p.id}`).then(r => r.data).catch(() => []))
      );
      setRecords(results.flat().sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()));
    } finally {
      setRecordsLoading(false);
    }
  }

  useEffect(() => { loadRecords(); }, [projects]);

  const filteredLog = records.filter(e =>
    e.materialName.toLowerCase().includes(logSearch.toLowerCase()) ||
    e.projectName.toLowerCase().includes(logSearch.toLowerCase())
  );

  const groupedByProject = useMemo(() => {
    const map = new Map<number, { projectId: number; projectName: string; records: ExcessWasteRecord[] }>();
    for (const e of filteredLog) {
      if (!map.has(e.projectId)) map.set(e.projectId, { projectId: e.projectId, projectName: e.projectName, records: [] });
      map.get(e.projectId)!.records.push(e);
    }
    return Array.from(map.values()).sort((a, b) =>
      Math.max(...b.records.map(r => new Date(r.recordedAt).getTime())) -
      Math.max(...a.records.map(r => new Date(r.recordedAt).getTime()))
    );
  }, [filteredLog]);

  const TABS: { id: Tab; label: string }[] = [
    { id:"overview", label:"Overview" },
    { id:"log",      label:"Excess Recording Log" },
  ];

  return (
    <div style={{ background:"#f5f4f0" }}>
      {redistributeTarget && (
        <RedistributeModal
          record={{
            id: redistributeTarget.id,
            materialName: redistributeTarget.materialName,
            quantity: redistributeTarget.quantity,
            unit: redistributeTarget.unit,
            projectId: redistributeTarget.projectId,
            projectName: redistributeTarget.projectName,
          }}
          onClose={() => setRedistributeTarget(null)}
          onSuccess={loadRecords}
        />
      )}

      {showRecordModal && (
        <RecordExcessModal
          projects={projects}
          onClose={() => setShowRecordModal(false)}
          onSuccess={loadRecords}
        />
      )}

      {editTarget && (
        <EditExcessModal
          record={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={loadRecords}
        />
      )}

      <Header title="Excess Analytics" />

      <div style={{ padding:"1.25rem 1.5rem" }}>

        {/* ── 3 stat cards ──────────────────────────────────────────────────── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:"1rem", marginBottom:"1.5rem" }}>
          {[
            { icon:Trash2,     iconBg:"#fee2e2", iconColor:"#dc2626", value:"5.2%", label:"Total Waste Rate",   badge:"↑ -1.3%", badgeBg:"#dcfce7", badgeColor:"#166534" },
            { icon:Monitor,    iconBg:"#ccfbf1", iconColor:"#0d9488", value:"127",  label:"Reusable Materials", badge:"↑ +15%",  badgeBg:"#dcfce7", badgeColor:"#166534" },
            { icon:Package,    iconBg:"#ffedd5", iconColor:"#ea580c", value:"6",    label:"Dead Stock Items",   badge:"↑ -2",    badgeBg:"#dcfce7", badgeColor:"#166534" },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} style={{ background:"#fff", borderRadius:14, padding:"1.25rem", boxShadow:"0 1px 3px rgba(0,0,0,0.07)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"0.875rem" }}>
                  <div style={{ width:40, height:40, borderRadius:10, background:s.iconBg, display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <Icon style={{ width:20, height:20, color:s.iconColor }} />
                  </div>
                  <span style={{ fontSize:"0.68rem", fontWeight:700, padding:"3px 8px", borderRadius:999, background:s.badgeBg, color:s.badgeColor }}>{s.badge}</span>
                </div>
                <p style={{ fontSize:"1.9rem", fontWeight:800, color:"#111827", lineHeight:1 }}>{s.value}</p>
                <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginTop:4 }}>{s.label}</p>
              </div>
            );
          })}
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────────── */}
        <div style={{ display:"flex", gap:4, background:"#e5e7eb", borderRadius:8, padding:4, width:"fit-content", marginBottom:"1.25rem" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              padding:"6px 20px", borderRadius:6, fontSize:"0.875rem",
              fontWeight: tab===t.id ? 600 : 400, border:"none", cursor:"pointer",
              background: tab===t.id ? "#fff" : "transparent",
              color: tab===t.id ? "#111827" : "#6b7280",
              boxShadow: tab===t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              transition:"all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* Tab: Overview — still uses illustrative sample data, not yet wired    */}
        {/* to the real per-project excess/waste API. See the Log tab for the    */}
        {/* real, cross-project view.                                            */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {tab === "overview" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 320px", gap:"1rem" }}>

            {/* Bar chart */}
            <div style={{ background:"#fff", borderRadius:12, padding:"1.5rem", boxShadow:"0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <div style={{ width:26, height:26, borderRadius:6, background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Package style={{ width:14, height:14, color:"#6b7280" }} />
                </div>
                <span style={{ fontWeight:700, fontSize:"1rem" }}>Excess by Project</span>
              </div>
              <p style={{ color:"#9ca3af", fontSize:"0.72rem", marginBottom:"1.5rem" }}>Excess rate per project</p>

              <div style={{ display:"flex", flexDirection:"column", gap:"1.1rem" }}>
                {CHART_DATA.map(d => (
                  <div key={d.project} style={{ display:"flex", alignItems:"center", gap:"1rem" }}>
                    <span style={{ fontSize:"0.78rem", color:"#374151", width:180, flexShrink:0, textAlign:"right" }}>{d.project}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ height:10, background:"#f3f4f6", borderRadius:99 }}>
                        <div style={{ height:"100%", width:`${(d.rate/MAX_RATE)*100}%`, background:"#fbbf24", borderRadius:99 }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display:"flex", justifyContent:"flex-end", paddingLeft:196, marginTop:"0.75rem" }}>
                <div style={{ flex:1, display:"flex", justifyContent:"space-between" }}>
                  {["0","2%","4%","6%","8%"].map(l => <span key={l} style={{ fontSize:"0.65rem", color:"#9ca3af" }}>{l}</span>)}
                </div>
              </div>

              <div style={{ display:"flex", gap:"1.5rem", justifyContent:"center", marginTop:"1rem" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:12, height:12, borderRadius:"50%", background:"#fbbf24" }} />
                  <span style={{ fontSize:"0.75rem", color:"#6b7280" }}>Excess Rate (%)</span>
                </div>
              </div>
            </div>

            {/* Excess Summary panel */}
            <div style={{ background:"#fff", borderRadius:12, padding:"1.5rem", boxShadow:"0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <FileText style={{ width:16, height:16, color:"#6b7280" }} />
                <span style={{ fontWeight:700, fontSize:"0.95rem" }}>Excess Summary</span>
              </div>
              <p style={{ color:"#9ca3af", fontSize:"0.72rem", marginBottom:"1.5rem" }}>Overall project summary</p>

              {[
                { icon:TrendingUp, iconBg:"#fffbeb", iconColor:"#d97706", label:"Total Excess Rate", value:"3.1%" },
              ].map(r => {
                const Icon = r.icon;
                return (
                  <div key={r.label} style={{ display:"flex", alignItems:"center", gap:10, padding:"0.875rem", background:"#f9fafb", borderRadius:10, marginBottom:"0.75rem" }}>
                    <div style={{ width:34, height:34, borderRadius:8, background:r.iconBg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <Icon style={{ width:16, height:16, color:r.iconColor }} />
                    </div>
                    <div style={{ flex:1 }}>
                      <p style={{ fontSize:"0.75rem", color:"#6b7280" }}>{r.label}</p>
                    </div>
                    <span style={{ fontWeight:700, fontSize:"0.9rem", color:"#111827" }}>{r.value}</span>
                  </div>
                );
              })}

              <p style={{ fontSize:"0.78rem", color:"#9ca3af", lineHeight:1.6, marginTop:"1rem" }}>
                Excess rate stands at 3.1% across all active projects, remaining within acceptable thresholds for the current period.
              </p>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* Tab: Excess Recording Log — real data, aggregated across projects     */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {tab === "log" && (
          <div style={{ background:"#fff", borderRadius:12, padding:"1.5rem", boxShadow:"0 1px 3px rgba(0,0,0,0.07)", border:"2px solid #f97316" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:8, background:"#ffedd5", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <FileText style={{ width:18, height:18, color:"#f97316" }} />
                </div>
                <div>
                  <p style={{ fontWeight:800, fontSize:"1rem", color:"#111827" }}>Excess Recording Log</p>
                  <p style={{ fontSize:"0.7rem", color:"#9ca3af" }}>All recorded waste &amp; excess entries, across every project</p>
                </div>
              </div>
              <div style={{ display:"flex", gap:"0.75rem", alignItems:"center" }}>
                <div style={{ position:"relative" }}>
                  <Search style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", width:14, height:14, color:"#9ca3af", pointerEvents:"none" }} />
                  <input
                    suppressHydrationWarning value={logSearch} onChange={e=>setLogSearch(e.target.value)}
                    placeholder="Search material, project..."
                    style={{ paddingLeft:32, paddingRight:12, paddingTop:8, paddingBottom:8, borderRadius:8, border:"1px solid #e5e7eb", background:"#f9fafb", fontSize:"0.8rem", outline:"none", width:220, color:"#111827" }}
                  />
                </div>
                <button onClick={() => setShowRecordModal(true)} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.8rem", fontWeight:700, cursor:"pointer" }}>
                  <Plus style={{ width:14, height:14 }} /> Excess Log
                </button>
              </div>
            </div>

            {recordsLoading && records.length === 0 ? (
              <p style={{ textAlign:"center", color:"#9ca3af", padding:"2.5rem" }}>Loading excess records…</p>
            ) : (
              <>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ borderBottom:"1px solid #e5e7eb" }}>
                      {["PROJECT","ENTRIES","LAST RECORDED","ACTION"].map(h => (
                        <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:"0.65rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.06em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupedByProject.map((g, gi) => {
                      const expanded = expandedProjectId === g.projectId;
                      const lastRecorded = Math.max(...g.records.map(r => new Date(r.recordedAt).getTime()));
                      return (
                        <Fragment key={g.projectId}>
                          <tr style={{ borderBottom: !expanded && gi < groupedByProject.length-1 ? "1px solid #f3f4f6" : "none" }}>
                            <td style={{ padding:"14px 12px", fontSize:"0.85rem", fontWeight:700, color:"#111827" }}>{g.projectName}</td>
                            <td style={{ padding:"14px 12px", fontSize:"0.82rem", color:"#374151" }}>{g.records.length}</td>
                            <td style={{ padding:"14px 12px", fontSize:"0.82rem", color:"#374151", whiteSpace:"nowrap" }}>{formatDate(new Date(lastRecorded).toISOString())}</td>
                            <td style={{ padding:"14px 12px" }}>
                              <button
                                onClick={() => setExpandedProjectId(expanded ? null : g.projectId)}
                                style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 12px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.72rem", fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}
                              >
                                {expanded ? <ChevronDown style={{ width:12, height:12 }} /> : <ChevronRight style={{ width:12, height:12 }} />} View
                              </button>
                            </td>
                          </tr>
                          {expanded && (
                            <tr style={{ borderBottom: gi < groupedByProject.length-1 ? "1px solid #f3f4f6" : "none" }}>
                              <td colSpan={4} style={{ padding:"0 12px 16px 12px", background:"#f9fafb" }}>
                                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                                  <thead>
                                    <tr>
                                      {["DATE","PHASE","MATERIAL","TYPE","QTY","UNIT","ACTION"].map(h => (
                                        <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontSize:"0.62rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.05em" }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.records.map(e => {
                                      const typeStyle = EXCESS_TYPE_STYLE[e.excessType] ?? { bg:"#f3f4f6", color:"#6b7280" };
                                      return (
                                        <tr key={e.id} style={{ borderTop:"1px solid #e5e7eb" }}>
                                          <td style={{ padding:"10px", fontSize:"0.8rem", color:"#374151", whiteSpace:"nowrap" }}>{formatDate(e.recordedAt)}</td>
                                          <td style={{ padding:"10px" }}>
                                            <span style={{ fontSize:"0.72rem", fontWeight:500, color:"#374151", padding:"3px 9px", borderRadius:999, border:"1px solid #e5e7eb", background:"#fff", whiteSpace:"nowrap" }}>{e.phaseName || "—"}</span>
                                          </td>
                                          <td style={{ padding:"10px", fontSize:"0.8rem", fontWeight:600, color:"#111827" }}>{e.materialName}</td>
                                          <td style={{ padding:"10px" }}>
                                            <span style={{ fontSize:"0.65rem", fontWeight:700, padding:"3px 8px", borderRadius:999, background:typeStyle.bg, color:typeStyle.color, whiteSpace:"nowrap" }}>
                                              {e.excessType}
                                            </span>
                                          </td>
                                          <td style={{ padding:"10px", fontSize:"0.8rem", color:"#374151" }}>{e.quantity.toLocaleString()}</td>
                                          <td style={{ padding:"10px", fontSize:"0.8rem", color:"#9ca3af" }}>{e.unit}</td>
                                          <td style={{ padding:"10px" }}>
                                            <div style={{ display:"flex", gap:6 }}>
                                              <button
                                                onClick={() => setEditTarget(e)}
                                                style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.7rem", fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}
                                              >
                                                <Pencil style={{ width:11, height:11 }} /> Edit
                                              </button>
                                              {e.isReusable && (
                                                <button
                                                  onClick={() => setRedistributeTarget(e)}
                                                  style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.7rem", fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}
                                                >
                                                  <Recycle style={{ width:11, height:11 }} /> Redistribute
                                                </button>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {groupedByProject.length === 0 && (
                      <tr><td colSpan={4} style={{ padding:"2.5rem", textAlign:"center", color:"#9ca3af" }}>No entries match your search.</td></tr>
                    )}
                  </tbody>
                </table>

                <div style={{ marginTop:"1.25rem", paddingTop:"1rem", borderTop:"1px solid #f3f4f6" }}>
                  <p style={{ fontSize:"0.78rem", color:"#9ca3af" }}>
                    Showing {groupedByProject.length} project{groupedByProject.length === 1 ? "" : "s"} ({filteredLog.length} entries)
                  </p>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
