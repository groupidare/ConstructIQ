"use client";

import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import {
  Trash2, DollarSign, Monitor, Package,
  TrendingUp, FileText, Plus, Search, X, AlertTriangle,
  Calendar,
} from "lucide-react";

// ── Static data ───────────────────────────────────────────────────────────────

const CHART_DATA = [
  { project: "Metro Station Phase 3",   cost: 32000, rate: 6.2 },
  { project: "BGC Tower Complex",       cost: 18000, rate: 3.1 },
  { project: "Harbor Bridge Renovation",cost: 38000, rate: 7.1 },
  { project: "Southgate Mall Expansion",cost: 24000, rate: 4.8 },
  { project: "PUP ICTC Building",       cost: 12000, rate: 2.3 },
  { project: "ICTC HALL",               cost: 8600,  rate: 3.6 },
  { project: "PUP North Wing",          cost: 15400, rate: 5.4 },
  { project: "Group 11 House",          cost: 6200,  rate: 2.9 },
];

const MAX_COST = Math.max(...CHART_DATA.map(d => d.cost));
const MAX_RATE = Math.max(...CHART_DATA.map(d => d.rate));

interface LogEntry {
  id: number; date: string; project: string; phase: string;
  material: string; qty: number; unit: string; cost: number; type: "Waste" | "Excess";
}

const INITIAL_LOG: LogEntry[] = [
  { id:1, date:"May 27", project:"Metro Station...", phase:"Flooring",   material:"Portland Cement",     qty:8,   unit:"bags",  cost:2280, type:"Waste"  },
  { id:2, date:"May 26", project:"BGC Tower",        phase:"Structural", material:"Steel Bars (12 mm)",  qty:5,   unit:"pcs",   cost:1980, type:"Waste"  },
  { id:3, date:"May 26", project:"Harbor Bridge",    phase:"Finishing",  material:"CHB 4-inch blocks",   qty:120, unit:"pcs",   cost:1875, type:"Excess" },
  { id:4, date:"May 26", project:"Metro Station",    phase:"Flooring",   material:"Sand - fine agg.",    qty:2.4, unit:"cu.m",  cost:2145, type:"Excess" },
  { id:5, date:"May 26", project:"Southgate Mall",   phase:"Foundation", material:"Gravel - coarse agg.",qty:1.8, unit:"cu.m",  cost:2216, type:"Waste"  },
];

// ── Date Picker ───────────────────────────────────────────────────────────────

function DatePickerField({ value, onChange, inputStyle }: { value: Date; onChange: (d: Date) => void; inputStyle: React.CSSProperties }) {
  const [open, setOpen]           = useState(false);
  const [viewYear, setViewYear]   = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleOpen() {
    setOpen(o => {
      if (!o) { setViewYear(value.getFullYear()); setViewMonth(value.getMonth()); }
      return !o;
    });
  }

  function prevMonth() { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); }
  function nextMonth() { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); }

  const label = value.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays    = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input readOnly value={label} onClick={toggleOpen} style={{ ...inputStyle, paddingRight: 36, cursor: "pointer" }} suppressHydrationWarning />
      <button
        type="button"
        onClick={toggleOpen}
        style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", borderRadius: 6 }}
      >
        <Calendar style={{ width: 16, height: 16, color: "#6b7280" }} />
      </button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.18)", padding: "0.75rem", width: 260 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button type="button" onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: "1rem", padding: "2px 8px" }}>‹</button>
            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#111827" }}>
              {new Date(viewYear, viewMonth).toLocaleDateString("en-PH", { month: "long", year: "numeric" })}
            </span>
            <button type="button" onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: "1rem", padding: "2px 8px" }}>›</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <span key={i} style={{ fontSize: "0.62rem", color: "#9ca3af", textAlign: "center", fontWeight: 600 }}>{d}</span>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
            {cells.map((day, i) => {
              if (day === null) return <span key={i} />;
              const isSelected = value.getFullYear() === viewYear && value.getMonth() === viewMonth && value.getDate() === day;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => { onChange(new Date(viewYear, viewMonth, day)); setOpen(false); }}
                  style={{
                    width: 30, height: 30, borderRadius: 8, border: "none", cursor: "pointer",
                    fontSize: "0.75rem", fontWeight: isSelected ? 700 : 500,
                    background: isSelected ? "#f97316" : "transparent",
                    color: isSelected ? "#fff" : "#374151",
                  }}
                >{day}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Record Excess Modal ───────────────────────────────────────────────────────

interface MaterialRow {
  itemDesc: string; unit: string; qty: string; wasteType: "Waste"|"Excess"; unitCost: string;
}
const BLANK_ROW: MaterialRow = { itemDesc:"", unit:"bags", qty:"", wasteType:"Waste", unitCost:"" };

function RecordModal({ onClose, onSave }: { onClose: () => void; onSave: (entries: LogEntry[]) => void }) {
  const [project, setProject] = useState("Metro Station Phase 3");
  const [phase,   setPhase]   = useState("Flooring");
  const [date,    setDate]    = useState<Date>(new Date());
  const [rows,    setRows]    = useState<MaterialRow[]>([{ ...BLANK_ROW }]);

  const inp: React.CSSProperties = {
    background:"#f3f4f6", color:"#111827", border:"1px solid #e5e7eb", borderRadius:8,
    padding:"10px 12px", fontSize:"0.875rem", outline:"none", width:"100%", boxSizing:"border-box",
  };

  function updateRow(i: number, patch: Partial<MaterialRow>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  function addMaterialRow() {
    setRows(prev => [...prev, { ...BLANK_ROW }]);
  }

  function removeRow(i: number) {
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  function handleSave(addAnother = false) {
    const validRows = rows.filter(r => r.itemDesc && r.qty && r.unitCost);
    if (validRows.length === 0) { toast.error("Fill in all material fields."); return; }
    const dateLabel = date.toLocaleDateString("en-PH", { month:"short", day:"numeric" });
    const entries: LogEntry[] = validRows.map(r => ({
      id: Date.now() + Math.random(), date: dateLabel, project, phase,
      material: r.itemDesc, qty: Number(r.qty), unit: r.unit, cost: Number(r.qty) * Number(r.unitCost), type: r.wasteType,
    }));
    onSave(entries);
    toast.success(entries.length > 1 ? "Entries saved!" : "Entry saved!");
    if (addAnother) {
      setRows([{ ...BLANK_ROW }]);
    } else {
      onClose();
    }
  }

  const rowCols = "2fr 0.8fr 0.6fr 1fr 1fr 24px";

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:580, maxWidth:"calc(100vw - 2rem)", boxShadow:"0 20px 60px rgba(0,0,0,0.25)", maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem" }}>
          <div>
            <p style={{ fontWeight:800, fontSize:"1.1rem", color:"#111827" }}>Record Material Excess</p>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>Document excess material quantity</p>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer", padding:4 }}><X style={{ width:20, height:20 }} /></button>
        </div>

        <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8, padding:"0.75rem 1rem", marginBottom:"1.5rem", display:"flex", gap:10 }}>
          <AlertTriangle style={{ width:16, height:16, color:"#dc2626", flexShrink:0, marginTop:2 }} />
          <p style={{ fontSize:"0.8rem", color:"#dc2626", lineHeight:1.5 }}>
            Help improve our AI demand predictions. Documenting your weekly material excess directly informs the forecasting engine and optimizes future production cycle.
          </p>
        </div>

        <p style={{ fontSize:"0.7rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", marginBottom:"0.625rem" }}>PROJECT &amp; PHASE</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem", marginBottom:"0.75rem" }}>
          <div>
            <p style={{ fontSize:"0.68rem", color:"#6b7280", marginBottom:4 }}>PROJECT *</p>
            <select value={project} onChange={e=>setProject(e.target.value)} style={{ ...inp, appearance:"none" as React.CSSProperties["appearance"], cursor:"pointer" }}>
              {["Metro Station Phase 3","BGC Tower Complex","Harbor Bridge Renovation","Southgate Mall Expansion","PUP ICTC Building","ICTC HALL","PUP North Wing","Group 11 House"].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <p style={{ fontSize:"0.68rem", color:"#6b7280", marginBottom:4 }}>PHASE *</p>
            <input value={phase} onChange={e=>setPhase(e.target.value)} style={inp} suppressHydrationWarning />
          </div>
        </div>
        <div style={{ marginBottom:"1.5rem", width:"50%" }}>
          <p style={{ fontSize:"0.68rem", color:"#6b7280", marginBottom:4 }}>DATE *</p>
          <DatePickerField value={date} onChange={setDate} inputStyle={inp} />
        </div>

        <p style={{ fontSize:"0.7rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", marginBottom:"0.625rem" }}>MATERIAL DETAILS</p>
        <div style={{ display:"grid", gridTemplateColumns:rowCols, gap:"0.5rem", marginBottom:"0.5rem" }}>
          {["ITEM DESCRIPTION","UNIT","QTY","WASTE / EXCESS","EST. UNIT COST",""].map(h => (
            <p key={h} style={{ fontSize:"0.65rem", color:"#9ca3af" }}>{h}</p>
          ))}
        </div>
        {rows.map((row, i) => (
          <div key={i} style={{ display:"grid", gridTemplateColumns:rowCols, gap:"0.5rem", marginBottom:"0.5rem", alignItems:"center" }}>
            <input value={row.itemDesc} onChange={e=>updateRow(i,{ itemDesc:e.target.value })} placeholder="e.g. Portland Cement" style={inp} suppressHydrationWarning />
            <select value={row.unit} onChange={e=>updateRow(i,{ unit:e.target.value })} style={{ ...inp, appearance:"none" as React.CSSProperties["appearance"] }}>
              {["bags","pcs","m³","cu.m","rolls","sheets","sqm"].map(u => <option key={u}>{u}</option>)}
            </select>
            <input value={row.qty} onChange={e=>updateRow(i,{ qty:e.target.value })} type="number" style={inp} suppressHydrationWarning />
            <div style={{ display:"flex", gap:2, background:"#f3f4f6", borderRadius:8, padding:2, border:"1px solid #e5e7eb" }}>
              {(["Waste","Excess"] as const).map(t => (
                <button key={t} type="button" onClick={()=>updateRow(i,{ wasteType:t })} style={{
                  flex:1, padding:"7px 0", fontSize:"0.72rem", fontWeight:600, borderRadius:6, border:"none",
                  cursor:"pointer",
                  background: row.wasteType===t ? "#fff" : "transparent",
                  color:      row.wasteType===t ? "#111827" : "#9ca3af",
                  boxShadow:  row.wasteType===t ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                }}>{t}</button>
              ))}
            </div>
            <div style={{ position:"relative" }}>
              <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"#9ca3af", fontSize:"0.8rem", pointerEvents:"none" }}>₱</span>
              <input value={row.unitCost} onChange={e=>updateRow(i,{ unitCost:e.target.value })} type="number" style={{ ...inp, paddingLeft:22 }} suppressHydrationWarning />
            </div>
            {rows.length > 1 ? (
              <button type="button" onClick={()=>removeRow(i)} style={{ background:"none", border:"none", color:"#9ca3af", cursor:"pointer", padding:2 }}>
                <X style={{ width:14, height:14 }} />
              </button>
            ) : <span />}
          </div>
        ))}

        <button type="button" onClick={addMaterialRow} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", color:"#059669", fontSize:"0.82rem", fontWeight:600, cursor:"pointer", padding:"4px 0", marginBottom:"0.75rem" }}>
          <Plus style={{ width:14, height:14 }} /> Add material
        </button>

        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end", marginTop:"1rem", paddingTop:"1rem", borderTop:"1px solid #f3f4f6" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", fontWeight:500, cursor:"pointer" }}>Cancel</button>
          <button onClick={()=>handleSave(true)} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:600, cursor:"pointer" }}>Save &amp; Add Another</button>
          <button onClick={()=>handleSave(false)} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:600, cursor:"pointer" }}>Save Entry</button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "overview" | "log";

export default function ExcessAnalyticsPage() {
  const [tab,       setTab]       = useState<Tab>("overview");
  const [showModal, setShowModal] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [logEntries, setLogEntries] = useState<LogEntry[]>(INITIAL_LOG);

  const filteredLog = logEntries.filter(e =>
    e.material.toLowerCase().includes(logSearch.toLowerCase()) ||
    e.project.toLowerCase().includes(logSearch.toLowerCase())
  );

  const TABS: { id: Tab; label: string }[] = [
    { id:"overview", label:"Overview" },
    { id:"log",      label:"Excess Recording Log" },
  ];

  return (
    <div style={{ background:"#f5f4f0" }}>
      {showModal && <RecordModal onClose={()=>setShowModal(false)} onSave={entries=>setLogEntries(prev=>[...entries,...prev])} />}

      <Header title="Excess Analytics" />

      <div style={{ padding:"1.25rem 1.5rem" }}>

        {/* ── 4 stat cards ──────────────────────────────────────────────────── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:"1rem", marginBottom:"1.5rem" }}>
          {[
            { icon:Trash2,     iconBg:"#fee2e2", iconColor:"#dc2626", value:"5.2%",  label:"Total Waste Rate",              badge:"↑ -1.3%", badgeBg:"#dcfce7", badgeColor:"#166534" },
            { icon:DollarSign, iconBg:"#d1fae5", iconColor:"#059669", value:"₱63k",  label:"Waste Cost (May)",              badge:"↑ -8.7%", badgeBg:"#dcfce7", badgeColor:"#166534" },
            { icon:Monitor,    iconBg:"#ccfbf1", iconColor:"#0d9488", value:"₱127k", label:"Reusable Materials",            badge:"↑ +15%",  badgeBg:"#dcfce7", badgeColor:"#166534" },
            { icon:Package,    iconBg:"#ffedd5", iconColor:"#ea580c", value:"6",     label:"Dead Stock Items",              badge:"↑ -2",    badgeBg:"#dcfce7", badgeColor:"#166534" },
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
        {/* Tab: Overview                                                        */}
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
              <p style={{ color:"#9ca3af", fontSize:"0.72rem", marginBottom:"1.5rem" }}>Excess cost and rate per project</p>

              <div style={{ display:"flex", flexDirection:"column", gap:"1.1rem" }}>
                {CHART_DATA.map(d => (
                  <div key={d.project} style={{ display:"flex", alignItems:"center", gap:"1rem" }}>
                    <span style={{ fontSize:"0.78rem", color:"#374151", width:180, flexShrink:0, textAlign:"right" }}>{d.project}</span>
                    <div style={{ flex:1, display:"flex", flexDirection:"column", gap:4 }}>
                      <div style={{ height:10, background:"#f3f4f6", borderRadius:99 }}>
                        <div style={{ height:"100%", width:`${(d.cost/MAX_COST)*100}%`, background:"#22c55e", borderRadius:99 }} />
                      </div>
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
              <div style={{ display:"flex", justifyContent:"flex-end", paddingLeft:196 }}>
                <div style={{ flex:1, display:"flex", justifyContent:"space-between" }}>
                  {["₱0","₱10k","₱20k","₱30k","₱40k"].map(l => <span key={l} style={{ fontSize:"0.6rem", color:"#9ca3af" }}>{l}</span>)}
                </div>
              </div>

              <div style={{ display:"flex", gap:"1.5rem", justifyContent:"center", marginTop:"1rem" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:12, height:12, borderRadius:"50%", background:"#22c55e" }} />
                  <span style={{ fontSize:"0.75rem", color:"#6b7280" }}>Excess Cost (₱)</span>
                </div>
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
                { icon:TrendingUp, iconBg:"#fffbeb", iconColor:"#d97706", label:"Total Excess Rate", value:"3.1%",  change:"+0.5%", changeColor:"#3b82f6" },
                { icon:DollarSign, iconBg:"#d1fae5", iconColor:"#059669", label:"Total Excess Cost",  value:"₱48k",  change:"+3.2%", changeColor:"#3b82f6" },
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
                    <span style={{ fontSize:"0.72rem", fontWeight:600, color:r.changeColor }}>{r.change}</span>
                  </div>
                );
              })}

              <p style={{ fontSize:"0.78rem", color:"#9ca3af", lineHeight:1.6, marginTop:"1rem" }}>
                Excess rate has <span style={{ textDecoration:"underline" }}>increased slightly by +0.5%</span>, reaching 3.1% across all active projects. Total excess cost stands at ₱48k with a moderate rise of +3.2%, remaining within acceptable thresholds for the current period.
              </p>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* Tab: Excess Recording Log                                            */}
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
                  <p style={{ fontSize:"0.7rem", color:"#9ca3af" }}>All recorded waste &amp; excess entries · primary tracking module</p>
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
                <button onClick={()=>setShowModal(true)} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.8rem", fontWeight:700, cursor:"pointer" }}>
                  <Plus style={{ width:14, height:14 }} /> Record Excess
                </button>
              </div>
            </div>

            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid #e5e7eb" }}>
                  {["DATE","PROJECT","PHASE","MATERIAL","TYPE","QTY","UNIT","COST (₱)"].map(h => (
                    <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:"0.65rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLog.map((e, i) => (
                  <tr key={e.id} style={{ borderBottom: i < filteredLog.length-1 ? "1px solid #f3f4f6" : "none" }}>
                    <td style={{ padding:"14px 12px", fontSize:"0.82rem", color:"#374151", fontWeight:500 }}>{e.date}</td>
                    <td style={{ padding:"14px 12px", fontSize:"0.82rem", color:"#374151" }}>{e.project}</td>
                    <td style={{ padding:"14px 12px" }}>
                      <span style={{ fontSize:"0.75rem", fontWeight:500, color:"#374151", padding:"4px 10px", borderRadius:999, border:"1px solid #e5e7eb", background:"#fff", whiteSpace:"nowrap" }}>{e.phase}</span>
                    </td>
                    <td style={{ padding:"14px 12px", fontSize:"0.82rem", fontWeight:600, color:"#111827" }}>{e.material}</td>
                    <td style={{ padding:"14px 12px" }}>
                      <span style={{ fontSize:"0.68rem", fontWeight:700, padding:"3px 8px", borderRadius:999,
                        background: e.type==="Waste" ? "#fee2e2" : "#fef3c7",
                        color:      e.type==="Waste" ? "#dc2626" : "#b45309" }}>
                        {e.type}
                      </span>
                    </td>
                    <td style={{ padding:"14px 12px", fontSize:"0.82rem", color:"#374151" }}>{e.qty}</td>
                    <td style={{ padding:"14px 12px", fontSize:"0.82rem", color:"#9ca3af" }}>{e.unit}</td>
                    <td style={{ padding:"14px 12px", fontSize:"0.82rem", fontWeight:700, color:"#111827" }}>₱{e.cost.toLocaleString()}</td>
                  </tr>
                ))}
                {filteredLog.length === 0 && (
                  <tr><td colSpan={8} style={{ padding:"2.5rem", textAlign:"center", color:"#9ca3af" }}>No entries match your search.</td></tr>
                )}
              </tbody>
            </table>

            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:"1.25rem", paddingTop:"1rem", borderTop:"1px solid #f3f4f6" }}>
              <p style={{ fontSize:"0.78rem", color:"#9ca3af" }}>
                Showing {filteredLog.length} of {logEntries.length} entries
              </p>
              <p style={{ fontSize:"0.78rem", color:"#374151", fontWeight:500 }}>
                Total cost shown: ₱{filteredLog.reduce((s, e) => s + e.cost, 0).toLocaleString()}
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
