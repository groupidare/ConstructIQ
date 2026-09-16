"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import { useAuthStore } from "@/store/authStore";
import { Avatar } from "@/components/ui/Avatar";
import api from "@/lib/api";
import {
  Lock, Shield, CloudUpload, Database, ChevronRight,
  LogOut, Pencil, X, Eye, EyeOff, Search, RefreshCw, Camera, Trash2, Loader2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActivityLog {
  id: number;
  userId?: number;
  userDisplay: string;
  action: string;
  entityType?: string;
  entityId?: number;
  ipAddress?: string;
  details?: string;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  Admin:              "System Administrator",
  ProjectManager:     "Project Manager",
  SiteEngineer:       "Site Engineer / PIC",
  WarehousePersonnel: "Warehouse Personnel",
  ProcurementOfficer: "Procurement Officer",
};

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-PH", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        width: 44, height: 24, borderRadius: 12, padding: 0, border: "none", cursor: "pointer",
        background: on ? "#f97316" : "#d1d5db", position: "relative", flexShrink: 0,
        transition: "background 0.2s",
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: on ? 23 : 3,
        width: 18, height: 18, borderRadius: "50%", background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s",
      }} />
    </button>
  );
}

// ── Security row ──────────────────────────────────────────────────────────────

function SecRow({ icon: Icon, label, onClick }: { icon: React.ElementType; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      width: "100%", padding: "14px 16px", borderRadius: 10, border: "none",
      background: "#f5f4f0", cursor: "pointer", marginBottom: 8,
      textAlign: "left",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Icon style={{ width: 18, height: 18, color: "#6b7280" }} />
        <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "#111827" }}>{label}</span>
      </div>
      <ChevronRight style={{ width: 16, height: 16, color: "#9ca3af" }} />
    </button>
  );
}

// ── Change Password modal ─────────────────────────────────────────────────────

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current,  setCurrent]  = useState("");
  const [next,     setNext]     = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showCur,  setShowCur]  = useState(false);
  const [showNew,  setShowNew]  = useState(false);
  const [saving,   setSaving]   = useState(false);

  async function handleSave() {
    if (!current || !next || !confirm) { toast.error("All fields required."); return; }
    if (next !== confirm)              { toast.error("Passwords do not match."); return; }
    if (next.length < 8)              { toast.error("Password must be at least 8 characters."); return; }
    setSaving(true);
    try {
      await api.post("/auth/change-password", { currentPassword: current, newPassword: next });
      toast.success("Password changed successfully.");
      onClose();
    } catch {
      toast.error("Incorrect current password or server error.");
    } finally {
      setSaving(false);
    }
  }

  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box" as const, padding: "10px 42px 10px 12px",
    background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8,
    fontSize: "0.875rem", outline: "none", color: "#111827",
  };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:440, boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <Lock style={{ width:18, height:18, color:"#374151" }} />
            <p style={{ fontWeight:800, fontSize:"1rem" }}>Change Password</p>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:18, height:18 }} /></button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.875rem" }}>
          {[
            ["Current Password", current, setCurrent, showCur, setShowCur],
            ["New Password",     next,    setNext,    showNew, setShowNew],
            ["Confirm Password", confirm, setConfirm, showNew, setShowNew],
          ].map(([label, val, setter, show], i) => (
            <div key={String(label)}>
              <p style={{ fontSize:"0.72rem", color:"#6b7280", fontWeight:600, marginBottom:6 }}>{String(label)}</p>
              <div style={{ position:"relative" }}>
                <input
                  suppressHydrationWarning
                  type={i === 0 ? (showCur ? "text" : "password") : (showNew ? "text" : "password")}
                  value={val as string}
                  onChange={e => (setter as any)(e.target.value)}
                  placeholder="••••••••"
                  style={inp}
                />
                <button
                  type="button"
                  onClick={() => i === 0 ? setShowCur((s:boolean)=>!s) : setShowNew((s:boolean)=>!s)}
                  style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}
                >
                  {(i === 0 ? showCur : showNew) ? <EyeOff style={{ width:15, height:15 }} /> : <Eye style={{ width:15, height:15 }} />}
                </button>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize:"0.7rem", color:"#9ca3af", marginTop:"0.75rem" }}>Password must be at least 8 characters.</p>
        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer", opacity:saving?0.7:1 }}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MFA modal ─────────────────────────────────────────────────────────────────

function MFAModal({ onClose }: { onClose: () => void }) {
  const [enabled, setEnabled] = useState(false);
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:440, boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <Shield style={{ width:18, height:18, color:"#374151" }} />
            <p style={{ fontWeight:800, fontSize:"1rem" }}>Multi-Factor Authentication</p>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:18, height:18 }} /></button>
        </div>
        <div style={{ background:"#f9fafb", borderRadius:10, padding:"1rem", marginBottom:"1.25rem" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <p style={{ fontWeight:700, fontSize:"0.9rem" }}>Authenticator App</p>
              <p style={{ fontSize:"0.75rem", color:"#9ca3af", marginTop:2 }}>Use Google Authenticator or similar app</p>
            </div>
            <Toggle on={enabled} onChange={v => { setEnabled(v); toast.success(v ? "MFA enabled." : "MFA disabled."); }} />
          </div>
        </div>
        <p style={{ fontSize:"0.75rem", color:"#6b7280", lineHeight:1.6 }}>
          Multi-Factor Authentication adds an extra layer of security to your account. When enabled, you'll need to enter a code from your authenticator app in addition to your password.
        </p>
        <div style={{ display:"flex", justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.875rem", fontWeight:600, cursor:"pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Backup modal ──────────────────────────────────────────────────────────────

function BackupModal({ onClose }: { onClose: () => void }) {
  const [backing, setBacking] = useState(false);
  function doBackup() {
    setBacking(true);
    setTimeout(() => { setBacking(false); toast.success("Backup completed. File saved."); }, 1800);
  }
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:440, boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <CloudUpload style={{ width:18, height:18, color:"#374151" }} />
            <p style={{ fontWeight:800, fontSize:"1rem" }}>Backup and Restore</p>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:18, height:18 }} /></button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.75rem", marginBottom:"1.25rem" }}>
          <div style={{ background:"#f9fafb", borderRadius:10, padding:"1rem", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <p style={{ fontWeight:700, fontSize:"0.9rem" }}>Last Backup</p>
              <p style={{ fontSize:"0.75rem", color:"#9ca3af" }}>June 19, 2026 · 11:42 PM</p>
            </div>
            <span style={{ fontSize:"0.68rem", fontWeight:700, padding:"3px 8px", borderRadius:999, background:"#dcfce7", color:"#15803d" }}>SUCCESS</span>
          </div>
          <button onClick={doBackup} disabled={backing} style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"11px", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.875rem", fontWeight:600, cursor:"pointer", opacity:backing?0.7:1 }}>
            {backing ? <><RefreshCw style={{ width:15, height:15, animation:"spin 1s linear infinite" }} /> Backing up…</> : <><CloudUpload style={{ width:15, height:15 }} /> Create Backup Now</>}
          </button>
        </div>
        <div style={{ display:"flex", justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ padding:"9px 24px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", fontSize:"0.875rem", cursor:"pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Activity Log mock data ────────────────────────────────────────────────────

function minsAgo(m: number) { return new Date(Date.now() - m * 60000).toISOString(); }

const MOCK_LOGS: ActivityLog[] = [
  { id:1,  userDisplay:"Ana Bonifacio",   action:"USER_LOGIN",           entityType:"User",         entityId:5,  ipAddress:"192.168.1.10", details:"Login from Chrome/Windows",                     createdAt: minsAgo(2)    },
  { id:2,  userDisplay:"Remy Santos",     action:"USER_LOGIN",           entityType:"User",         entityId:1,  ipAddress:"192.168.1.14", details:"Login from Chrome/Windows",                     createdAt: minsAgo(8)    },
  { id:3,  userDisplay:"Remy Santos",     action:"PROJECT_UPDATED",      entityType:"Project",      entityId:2,  ipAddress:"192.168.1.14", details:"Updated status: Planning → Active",             createdAt: minsAgo(14)   },
  { id:4,  userDisplay:"Marco Dela Cruz", action:"PO_CREATED",           entityType:"PurchaseOrder",entityId:18, ipAddress:"192.168.1.22", details:"PO-2025-0844 · Steel Bars · ₱97,200",           createdAt: minsAgo(22)   },
  { id:5,  userDisplay:"Carlo Reyes",     action:"EXCESS_RECORDED",      entityType:"ExcessWaste",  entityId:37, ipAddress:"192.168.1.31", details:"Sand excess — 4.2 m³ @ Metro Station Phase 3",  createdAt: minsAgo(35)   },
  { id:6,  userDisplay:"Ana Bonifacio",   action:"USER_CREATED",         entityType:"User",         entityId:9,  ipAddress:"192.168.1.10", details:"New user: j.delacruz (Site Engineer)",          createdAt: minsAgo(48)   },
  { id:7,  userDisplay:"Liza Domingo",    action:"INVENTORY_UPDATED",    entityType:"Inventory",    entityId:12, ipAddress:"192.168.1.28", details:"Portland Cement: 280 → 230 bags (Metro Stn.)",  createdAt: minsAgo(61)   },
  { id:8,  userDisplay:"Marco Dela Cruz", action:"PO_APPROVED",          entityType:"PurchaseOrder",entityId:16, ipAddress:"192.168.1.22", details:"PO-2025-0839 approved by Ana Bonifacio",        createdAt: minsAgo(90)   },
  { id:9,  userDisplay:"Carlo Reyes",     action:"USER_LOGIN",           entityType:"User",         entityId:2,  ipAddress:"192.168.1.31", details:"Login from Firefox/Windows",                    createdAt: minsAgo(110)  },
  { id:10, userDisplay:"Liza Domingo",    action:"INVENTORY_CREATED",    entityType:"Inventory",    entityId:49, ipAddress:"192.168.1.28", details:"New item: Waterproofing Membrane — 150 rolls",  createdAt: minsAgo(145)  },
  { id:11, userDisplay:"Remy Santos",     action:"PROJECT_CREATED",      entityType:"Project",      entityId:6,  ipAddress:"192.168.1.14", details:"New project: Southgate Mall Expansion Phase 2", createdAt: minsAgo(180)  },
  { id:12, userDisplay:"Ana Bonifacio",   action:"ROLE_UPDATED",         entityType:"User",         entityId:7,  ipAddress:"192.168.1.10", details:"Changed role: SiteEngineer → ProjectManager",   createdAt: minsAgo(210)  },
  { id:13, userDisplay:"Maria Tan",       action:"USER_LOGIN",           entityType:"User",         entityId:6,  ipAddress:"192.168.1.41", details:"Login from Safari/macOS",                       createdAt: minsAgo(245)  },
  { id:14, userDisplay:"Marco Dela Cruz", action:"SUPPLIER_UPDATED",     entityType:"Supplier",     entityId:3,  ipAddress:"192.168.1.22", details:"PhilCon Aggregates — contact updated",          createdAt: minsAgo(280)  },
  { id:15, userDisplay:"Carlo Reyes",     action:"MEASUREMENT_ADDED",    entityType:"Project",      entityId:1,  ipAddress:"192.168.1.31", details:"Floor slab Zone A: 12m × 8m × 0.15m",          createdAt: minsAgo(310)  },
  { id:16, userDisplay:"System",          action:"FORECAST_GENERATED",   entityType:"Forecast",     entityId:22, ipAddress:"127.0.0.1",    details:"AI demand forecast updated — 30-day window",    createdAt: minsAgo(360)  },
  { id:17, userDisplay:"Liza Domingo",    action:"INVENTORY_DELETED",    entityType:"Inventory",    entityId:11, ipAddress:"192.168.1.28", details:"Removed: Old Paint Stock (expired)",            createdAt: minsAgo(420)  },
  { id:18, userDisplay:"Ana Bonifacio",   action:"SETTINGS_UPDATED",     entityType:"System",       entityId: undefined,   ipAddress:"192.168.1.10", details:"Notification preferences saved",                createdAt: minsAgo(480)  },
  { id:19, userDisplay:"Remy Santos",     action:"BOM_UPDATED",          entityType:"Project",      entityId:3,  ipAddress:"192.168.1.14", details:"Added 3 materials to Harbor Bridge BOM",        createdAt: minsAgo(540)  },
  { id:20, userDisplay:"Marco Dela Cruz", action:"PO_CREATED",           entityType:"PurchaseOrder",entityId:17, ipAddress:"192.168.1.22", details:"PO-2025-0843 · Gravel · ₱44,800",              createdAt: minsAgo(600)  },
  { id:21, userDisplay:"Ben Torres",      action:"USER_LOGIN",           entityType:"User",         entityId:7,  ipAddress:"192.168.1.55", details:"Login from Chrome/Android",                     createdAt: minsAgo(720)  },
  { id:22, userDisplay:"System",          action:"BACKUP_COMPLETED",     entityType:"System",       entityId: undefined,   ipAddress:"127.0.0.1",    details:"Automated nightly backup — 142 MB",             createdAt: minsAgo(780)  },
  { id:23, userDisplay:"Carlo Reyes",     action:"EXCESS_RECORDED",      entityType:"ExcessWaste",  entityId:36, ipAddress:"192.168.1.31", details:"Steel offcuts — 38 pcs @ BGC Tower Complex",   createdAt: minsAgo(840)  },
  { id:24, userDisplay:"Ana Bonifacio",   action:"USER_DEACTIVATED",     entityType:"User",         entityId:8,  ipAddress:"192.168.1.10", details:"Account deactivated: ben.torres",               createdAt: minsAgo(960)  },
  { id:25, userDisplay:"Remy Santos",     action:"REPORT_GENERATED",     entityType:"Report",       entityId:14, ipAddress:"192.168.1.14", details:"Inventory Status Report · PDF exported",        createdAt: minsAgo(1080) },
  { id:26, userDisplay:"Liza Domingo",    action:"INVENTORY_UPDATED",    entityType:"Inventory",    entityId:8,  ipAddress:"192.168.1.28", details:"Rebar: 600 → 540 pcs (Harbor Bridge)",          createdAt: minsAgo(1200) },
  { id:27, userDisplay:"Maria Tan",       action:"MEASUREMENT_ADDED",    entityType:"Project",      entityId:4,  ipAddress:"192.168.1.41", details:"Column grid C2: 0.4m × 0.4m × 3.2m",          createdAt: minsAgo(1320) },
  { id:28, userDisplay:"System",          action:"FORECAST_GENERATED",   entityType:"Forecast",     entityId:21, ipAddress:"127.0.0.1",    details:"Weekly AI forecast refresh completed",          createdAt: minsAgo(1440) },
  { id:29, userDisplay:"Marco Dela Cruz", action:"PO_DELETED",           entityType:"PurchaseOrder",entityId:15, ipAddress:"192.168.1.22", details:"Cancelled PO-2025-0838 (duplicate entry)",      createdAt: minsAgo(1560) },
  { id:30, userDisplay:"Ana Bonifacio",   action:"USER_LOGIN",           entityType:"User",         entityId:5,  ipAddress:"192.168.1.10", details:"Login from Edge/Windows",                       createdAt: minsAgo(1680) },
];

// ── Activity Log modal ────────────────────────────────────────────────────────

function ActivityLogModal({ onClose }: { onClose: () => void }) {
  const [logs,     setLogs]     = useState<ActivityLog[]>(MOCK_LOGS);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState("");
  const [filter,   setFilter]   = useState("All");
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 15;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ActivityLog[]>(`/activity-logs?page=1&pageSize=100`);
      if (data && data.length > 0) {
        // Merge API data on top of mock data, deduplicate by id
        const apiIds = new Set(data.map(d => d.id));
        setLogs([...data, ...MOCK_LOGS.filter(m => !apiIds.has(m.id))]);
      }
    } catch {
      // Keep mock data — no toast for silent fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const ACTION_TYPES = ["All", "LOGIN", "CREATED", "UPDATED", "DELETED", "FORECAST", "REPORT", "BACKUP"];

  const filtered = logs.filter(l => {
    const matchSearch = search === "" ||
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      l.userDisplay.toLowerCase().includes(search.toLowerCase()) ||
      (l.entityType ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (l.details ?? "").toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "All" || l.action.toUpperCase().includes(filter);
    return matchSearch && matchFilter;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function actionColor(action: string) {
    if (/login/i.test(action))             return { bg:"#dbeafe", color:"#1d4ed8" };
    if (/creat|add/i.test(action))         return { bg:"#dcfce7", color:"#15803d" };
    if (/delet|cancel|remov/i.test(action))return { bg:"#fee2e2", color:"#b91c1c" };
    if (/update|edit|patch|role/i.test(action)) return { bg:"#fef3c7", color:"#b45309" };
    if (/forecast|backup/i.test(action))   return { bg:"#ede9fe", color:"#6d28d9" };
    if (/report|export/i.test(action))     return { bg:"#f0fdf4", color:"#15803d" };
    if (/deactiv/i.test(action))           return { bg:"#fee2e2", color:"#b91c1c" };
    return { bg:"#f3f4f6", color:"#374151" };
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:"1rem" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, width:"min(760px,95vw)", maxHeight:"88vh", display:"flex", flexDirection:"column", boxShadow:"0 24px 64px rgba(0,0,0,0.22)" }}>
        {/* Header */}
        <div style={{ padding:"1.25rem 1.5rem", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <Database style={{ width:18, height:18, color:"#374151" }} />
              <p style={{ fontWeight:800, fontSize:"1rem" }}>Activity Log</p>
            </div>
            <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginTop:2 }}>System-wide audit trail of all user actions</p>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:18, height:18 }} /></button>
        </div>

        {/* Search + filter bar */}
        <div style={{ padding:"0.875rem 1.5rem", borderBottom:"1px solid #f3f4f6", display:"flex", gap:"0.75rem", flexShrink:0, flexWrap:"wrap" }}>
          <div style={{ position:"relative", flex:1, minWidth:200 }}>
            <Search style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", width:14, height:14, color:"#9ca3af", pointerEvents:"none" }} />
            <input
              suppressHydrationWarning
              value={search} onChange={e=>{ setSearch(e.target.value); setPage(1); }}
              placeholder="Search user, action, details…"
              style={{ width:"100%", boxSizing:"border-box" as const, paddingLeft:32, paddingRight:12, paddingTop:8, paddingBottom:8, borderRadius:8, background:"#f9fafb", border:"1px solid #e5e7eb", fontSize:"0.8rem", outline:"none" }}
            />
          </div>
          <select value={filter} onChange={e=>{ setFilter(e.target.value); setPage(1); }} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #e5e7eb", background:"#f9fafb", fontSize:"0.8rem", outline:"none", cursor:"pointer", color:"#374151" }}>
            {ACTION_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
          <button onClick={load} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 14px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", fontSize:"0.8rem", cursor:"pointer", color:"#374151", whiteSpace:"nowrap" }}>
            <RefreshCw style={{ width:13, height:13 }} /> Refresh
          </button>
        </div>

        {/* Stats row */}
        <div style={{ padding:"0.625rem 1.5rem", borderBottom:"1px solid #f3f4f6", display:"flex", gap:"1.25rem", flexShrink:0, background:"#fafafa" }}>
          {[
            ["Total Events", logs.length],
            ["Logins",       logs.filter(l=>/login/i.test(l.action)).length],
            ["Created",      logs.filter(l=>/creat/i.test(l.action)).length],
            ["Updated",      logs.filter(l=>/updat/i.test(l.action)).length],
            ["Deleted",      logs.filter(l=>/delet|cancel/i.test(l.action)).length],
          ].map(([label, val]) => (
            <div key={String(label)} style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:"0.72rem", color:"#9ca3af" }}>{label}:</span>
              <span style={{ fontSize:"0.78rem", fontWeight:700, color:"#374151" }}>{val}</span>
            </div>
          ))}
        </div>

        {/* Log table */}
        <div style={{ flex:1, overflowY:"auto" }}>
          {loading ? (
            <div style={{ padding:"3rem", textAlign:"center", color:"#9ca3af" }}>
              <RefreshCw style={{ width:22, height:22, margin:"0 auto 0.5rem", opacity:0.4 }} />
              <p>Loading activity logs…</p>
            </div>
          ) : paginated.length === 0 ? (
            <div style={{ padding:"3rem", textAlign:"center", color:"#9ca3af" }}>No matching activity logs.</div>
          ) : (
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead style={{ position:"sticky", top:0, background:"#fff", zIndex:1 }}>
                <tr style={{ borderBottom:"1px solid #f3f4f6" }}>
                  {["TIMESTAMP","USER","ACTION","DETAILS","ENTITY","IP"].map(h => (
                    <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:"0.6rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.06em", whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((log, i) => {
                  const ac = actionColor(log.action);
                  return (
                    <tr key={log.id} style={{ borderBottom:"1px solid #f9fafb", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding:"10px 14px", fontSize:"0.7rem", color:"#9ca3af", whiteSpace:"nowrap" }}>{relTime(log.createdAt)}</td>
                      <td style={{ padding:"10px 14px", fontSize:"0.78rem", fontWeight:600, color:"#111827", whiteSpace:"nowrap" }}>{log.userDisplay}</td>
                      <td style={{ padding:"10px 14px" }}>
                        <span style={{ fontSize:"0.65rem", fontWeight:700, padding:"3px 9px", borderRadius:999, background:ac.bg, color:ac.color, whiteSpace:"nowrap" }}>
                          {log.action}
                        </span>
                      </td>
                      <td style={{ padding:"10px 14px", fontSize:"0.75rem", color:"#6b7280", maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={log.details ?? ""}>
                        {log.details ?? "—"}
                      </td>
                      <td style={{ padding:"10px 14px", fontSize:"0.72rem", color:"#9ca3af", whiteSpace:"nowrap" }}>
                        {log.entityType ? `${log.entityType}${log.entityId ? ` #${log.entityId}` : ""}` : "—"}
                      </td>
                      <td style={{ padding:"10px 14px", fontSize:"0.68rem", color:"#9ca3af", fontFamily:"monospace", whiteSpace:"nowrap" }}>{log.ipAddress ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer pagination */}
        <div style={{ padding:"0.875rem 1.5rem", borderTop:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
          <p style={{ fontSize:"0.72rem", color:"#9ca3af" }}>
            Showing {Math.min((page-1)*PAGE_SIZE+1, filtered.length)}–{Math.min(page*PAGE_SIZE, filtered.length)} of {filtered.length} records
          </p>
          <div style={{ display:"flex", gap:"0.5rem", alignItems:"center" }}>
            <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page<=1} style={{ padding:"6px 14px", borderRadius:7, border:"1px solid #e5e7eb", background:"#fff", fontSize:"0.78rem", cursor:"pointer", opacity:page<=1?0.4:1 }}>← Prev</button>
            <span style={{ fontSize:"0.75rem", color:"#9ca3af", padding:"0 4px" }}>{page} / {totalPages}</span>
            <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page>=totalPages} style={{ padding:"6px 14px", borderRadius:7, border:"1px solid #e5e7eb", background:"#fff", fontSize:"0.78rem", cursor:"pointer", opacity:page>=totalPages?0.4:1 }}>Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Edit Profile modal ────────────────────────────────────────────────────────

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

function EditProfileModal({ onClose }: { onClose: () => void }) {
  const user       = useAuthStore(s => s.user);
  const updateUser = useAuthStore(s => s.updateUser);
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName,  setLastName]  = useState(user?.lastName  ?? "");
  const [email,     setEmail]     = useState(user?.email     ?? "");
  const [saving,    setSaving]    = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`.toUpperCase();

  // Avatar changes are staged locally and only sent to the server when
  // "Save Changes" is clicked, so "Cancel" genuinely discards them — same
  // as the name/email fields already do.
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [previewUrl,        setPreviewUrl]        = useState<string | null>(null);
  const [avatarRemoved,     setAvatarRemoved]     = useState(false);

  const displayedAvatarUrl = avatarRemoved ? null : (previewUrl ?? user?.avatarUrl);
  const hasPhotoToClear = !avatarRemoved && (!!previewUrl || !!user?.avatarUrl);

  const inp: React.CSSProperties = {
    width:"100%", boxSizing:"border-box" as const, padding:"9px 12px",
    background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:8,
    fontSize:"0.875rem", outline:"none", color:"#111827",
  };

  function handleAvatarSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      toast.error("Only JPEG, PNG, or WebP images are allowed.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error("Image must be 5MB or smaller.");
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatarFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setAvatarRemoved(false);
  }

  function handleClearAvatar() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatarFile(null);
    setPreviewUrl(null);
    setAvatarRemoved(true);
  }

  async function handleSave() {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      toast.error("First name, last name, and email are required.");
      return;
    }
    setSaving(true);
    try {
      let newAvatarUrl: string | null | undefined;

      if (pendingAvatarFile) {
        const formData = new FormData();
        formData.append("file", pendingAvatarFile);
        // The shared `api` instance defaults Content-Type to application/json;
        // that must not be sent here, or the browser never gets to attach the
        // multipart boundary and the server can't parse the upload.
        const { data } = await api.post("/users/me/avatar", formData, {
          headers: { "Content-Type": undefined },
        });
        newAvatarUrl = data.avatarUrl;
      } else if (avatarRemoved) {
        await api.delete("/users/me/avatar");
        newAvatarUrl = null;
      }

      const { data } = await api.put("/users/me", {
        firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(),
      });
      updateUser({
        firstName: data.firstName, lastName: data.lastName, email: data.email,
        ...(newAvatarUrl !== undefined ? { avatarUrl: newAvatarUrl } : {}),
      });
      toast.success("Profile updated.");
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onClose();
  }

  return (
    <div onClick={handleCancel} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:480, boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
          <p style={{ fontWeight:800, fontSize:"1rem" }}>Edit Profile</p>
          <button onClick={handleCancel} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:18, height:18 }} /></button>
        </div>

        {/* Avatar upload */}
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:"1.5rem" }}>
          <div style={{ position:"relative", width:64, height:64 }}>
            <Avatar avatarUrl={displayedAvatarUrl} initials={initials} size={64} fontSize="1.1rem" />
            {saving && (
              <div style={{ position:"absolute", inset:0, borderRadius:"50%", background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Loader2 style={{ width:20, height:20, color:"#fff" }} className="animate-spin" />
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
              aria-label="Change profile photo"
              style={{
                position:"absolute", bottom:-2, right:-2, width:26, height:26, borderRadius:"50%",
                background:"#111827", border:"2px solid #fff", color:"#fff",
                display:"flex", alignItems:"center", justifyContent:"center", cursor:saving?"default":"pointer",
              }}
            >
              <Camera style={{ width:13, height:13 }} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatarSelected}
              style={{ display:"none" }}
            />
          </div>
          <div>
            <p style={{ fontSize:"0.82rem", fontWeight:600, color:"#374151" }}>Profile photo</p>
            <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginTop:2 }}>JPEG, PNG, or WebP. Max 5MB.</p>
            {hasPhotoToClear && (
              <button
                type="button"
                onClick={handleClearAvatar}
                disabled={saving}
                style={{ display:"flex", alignItems:"center", gap:4, marginTop:6, background:"none", border:"none", color:"#dc2626", fontSize:"0.75rem", fontWeight:600, cursor:saving?"default":"pointer", padding:0 }}
              >
                <Trash2 style={{ width:12, height:12 }} /> Remove photo
              </button>
            )}
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem", marginBottom:"0.75rem" }}>
          <div><p style={{ fontSize:"0.72rem", color:"#6b7280", fontWeight:600, marginBottom:5 }}>First Name</p><input value={firstName} onChange={e=>setFirstName(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><p style={{ fontSize:"0.72rem", color:"#6b7280", fontWeight:600, marginBottom:5 }}>Last Name</p><input value={lastName} onChange={e=>setLastName(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div style={{ gridColumn:"1/-1" }}><p style={{ fontSize:"0.72rem", color:"#6b7280", fontWeight:600, marginBottom:5 }}>Email</p><input value={email} onChange={e=>setEmail(e.target.value)} style={inp} suppressHydrationWarning /></div>
        </div>
        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end", marginTop:"1rem" }}>
          <button onClick={handleCancel} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer", opacity:saving?0.7:1 }}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background:"#fff", borderRadius:14, boxShadow:"0 1px 3px rgba(0,0,0,0.07)", marginBottom:"1.25rem", overflow:"hidden" }}>
      <div style={{ padding:"1rem 1.5rem", borderBottom:"1px solid #f3f4f6" }}>
        <p style={{ fontWeight:700, fontSize:"0.95rem", color:"#111827" }}>{title}</p>
      </div>
      <div style={{ padding:"1.25rem 1.5rem" }}>
        {children}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type ModalType = "changePassword" | "mfa" | "backup" | "activityLog" | "editProfile" | "signOutConfirm" | null;

// ── Sign Out Confirmation Modal ───────────────────────────────────────────────

function SignOutConfirmModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      onClick={onCancel}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:"#fff", borderRadius:20, padding:"2.5rem 2rem 2rem", width:"100%", maxWidth:440, display:"flex", flexDirection:"column", alignItems:"center", gap:"1.25rem", boxShadow:"0 24px 60px rgba(0,0,0,0.2)" }}
      >
        {/* Icon */}
        <div style={{ width:72, height:72, borderRadius:"50%", background:"#fff1f1", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ width:52, height:52, borderRadius:"50%", background:"#fee2e2", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <LogOut style={{ width:26, height:26, color:"#dc2626" }} />
          </div>
        </div>
        {/* Title */}
        <h2 style={{ fontWeight:800, fontSize:"1.3rem", color:"#111827", textAlign:"center", lineHeight:1.3 }}>
          Sign out of ConstructIQ?
        </h2>
        {/* Buttons */}
        <div style={{ display:"flex", gap:"1rem", width:"100%", marginTop:"0.25rem" }}>
          <button
            onClick={onCancel}
            style={{ flex:1, padding:"13px 0", borderRadius:10, border:"1.5px solid #e5e7eb", background:"#fff", fontWeight:700, fontSize:"0.95rem", color:"#374151", cursor:"pointer", transition:"background 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
            onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
          >Stay signed in</button>
          <button
            onClick={onConfirm}
            style={{ flex:1, padding:"13px 0", borderRadius:10, border:"none", background:"#9b1c1c", color:"#fff", fontWeight:700, fontSize:"0.95rem", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, transition:"opacity 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.88")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >
            <LogOut style={{ width:17, height:17 }} /> Yes, sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const user   = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const router = useRouter();

  const [modal, setModal] = useState<ModalType>(null);
  const [notifs, setNotifs] = useState({
    shortageAlerts:    true,
    overstockWarnings: true,
    deliveryUpdates:   true,
    wasteReports:      false,
    aiForecastUpdates: true,
  });

  function handleSignOut() {
    logout();
    router.push("/");
  }

  function confirmSignOut() { setModal("signOutConfirm"); }

  const fullName = user ? `${user.firstName} ${user.lastName}` : "";
  const roleLabel = ROLE_LABELS[user?.role ?? ""] ?? "User";
  const ini  = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`.toUpperCase();

  const readonlyField: React.CSSProperties = {
    width:"100%", boxSizing:"border-box" as const, padding:"10px 14px",
    background:"#f3f4f6", border:"none", borderRadius:8,
    fontSize:"0.875rem", color:"#6b7280",
  };

  return (
    <div style={{ background:"#f5f4f0", minHeight:"100vh" }}>
      {/* Modals */}
      {modal === "editProfile"   && <EditProfileModal    onClose={()=>setModal(null)} />}
      {modal === "changePassword"&& <ChangePasswordModal onClose={()=>setModal(null)} />}
      {modal === "mfa"           && <MFAModal            onClose={()=>setModal(null)} />}
      {modal === "backup"        && <BackupModal         onClose={()=>setModal(null)} />}
      {modal === "activityLog"   && <ActivityLogModal    onClose={()=>setModal(null)} />}
      {modal === "signOutConfirm" && <SignOutConfirmModal onCancel={()=>setModal(null)} onConfirm={handleSignOut} />}

      <Header title="Settings" />

      <div style={{ padding:"1.25rem 1.5rem", maxWidth:900, margin:"0 auto" }}>

        {/* ── Account Information ── */}
        <Card title="Account Information">
          {/* User summary row */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <Avatar avatarUrl={user?.avatarUrl} initials={ini} size={48} fontSize="1rem" />
              <div>
                <p style={{ fontWeight:800, fontSize:"1rem", color:"#111827" }}>{fullName}</p>
                <p style={{ fontSize:"0.75rem", color:"#9ca3af", marginTop:2 }}>
                  {roleLabel} &nbsp;·&nbsp; {user?.email}
                </p>
              </div>
            </div>
            <button onClick={()=>setModal("editProfile")} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", fontSize:"0.82rem", fontWeight:600, color:"#374151", cursor:"pointer" }}>
              <Pencil style={{ width:13, height:13 }} /> Edit Profile
            </button>
          </div>

          {/* Fields grid */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem" }}>
            <div>
              <p style={{ fontSize:"0.78rem", color:"#374151", fontWeight:600, marginBottom:6 }}>Full Name</p>
              <input readOnly value={fullName} style={readonlyField} suppressHydrationWarning />
            </div>
            <div>
              <p style={{ fontSize:"0.78rem", color:"#374151", fontWeight:600, marginBottom:6 }}>Email</p>
              <input readOnly value={user?.email ?? ""} style={readonlyField} suppressHydrationWarning />
            </div>
            <div>
              <p style={{ fontSize:"0.78rem", color:"#374151", fontWeight:600, marginBottom:6 }}>Role</p>
              <input readOnly value={roleLabel} style={readonlyField} suppressHydrationWarning />
            </div>
          </div>
        </Card>

        {/* ── Notification Preferences ── */}
        <Card title="Notification Preferences">
          {([
            ["shortageAlerts",    "Shortage Alerts",       "Get notified when materials reach critical levels"],
            ["overstockWarnings", "Overstock Warnings",    "Alerts for materials exceeding maximum thresholds"],
            ["deliveryUpdates",   "Delivery Updates",      "Track procurement order status changes"],
            ["wasteReports",      "Waste Reports",         "Weekly waste analytics summary"],
            ["aiForecastUpdates", "AI Forecast Updates",   "Notifications when demand predictions change significantly"],
          ] as [keyof typeof notifs, string, string][]).map(([key, title, desc], i, arr) => (
            <div key={key} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 0", borderBottom: i < arr.length-1 ? "1px solid #f3f4f6" : "none" }}>
              <div>
                <p style={{ fontWeight:600, fontSize:"0.875rem", color:"#111827" }}>{title}</p>
                <p style={{ fontSize:"0.72rem", color:"#9ca3af", marginTop:2 }}>{desc}</p>
              </div>
              <Toggle on={notifs[key]} onChange={v => {
                setNotifs(n => ({ ...n, [key]: v }));
                toast.success(`${title} ${v ? "enabled" : "disabled"}.`);
              }} />
            </div>
          ))}
        </Card>

        {/* ── Privacy and Security ── */}
        <Card title="Privacy and Security">
          <SecRow icon={Lock}        label="Change Password"                onClick={()=>setModal("changePassword")} />
          <SecRow icon={Shield}      label="Multi-Factor Authentication (MFA)" onClick={()=>setModal("mfa")} />
          <SecRow icon={CloudUpload} label="Backup and Restore"             onClick={()=>setModal("backup")} />
          <SecRow icon={Database}    label="Activity Log"                   onClick={()=>setModal("activityLog")} />
        </Card>

        {/* ── Sign Out ── */}
        <div style={{ background:"#fff", borderRadius:14, boxShadow:"0 1px 3px rgba(0,0,0,0.07)", padding:"1.25rem 1.5rem", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <p style={{ fontWeight:700, fontSize:"0.95rem", color:"#111827" }}>Sign Out</p>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>Sign out of your ConstructIQ account</p>
          </div>
          <button onClick={confirmSignOut} style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 20px", borderRadius:8, border:"1px solid #fed7aa", background:"#fff7f2", color:"#f97316", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>
            <LogOut style={{ width:15, height:15 }} /> Sign Out
          </button>
        </div>

      </div>
    </div>
  );
}
