"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import api from "@/lib/api";
import {
  Plus, Pencil, BookOpen, Trash2, X,
  LayoutDashboard, TrendingUp, Warehouse, ShoppingCart, Shield, Users,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserRecord {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  phoneNumber?: string;
  createdAt: string;
  lastLogin?: string;
  projectCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  Admin:              "System Administrator",
  ProjectManager:     "Project Manager",
  SiteEngineer:       "Site Engineer / PIC",
  WarehousePersonnel: "Warehouse Personnel",
  ProcurementOfficer: "Procurement Officer",
};

const AVATAR_COLORS: string[] = [
  "#1e3154","#0f4c75","#1b6ca8","#065f46","#7c3aed","#9a3412","#1e40af","#134e4a",
];

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initials(first: string, last: string) {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

// The backend serializes DateTimes as UTC but without a "Z"/offset suffix
// (a MySQL + EF Core quirk), so the browser's Date parser would otherwise
// read them as local time and throw relative times off by the UTC offset.
function parseUtc(iso: string): Date {
  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(iso);
  return new Date(hasTimezone ? iso : `${iso}Z`);
}

function relativeTime(iso?: string): string {
  if (!iso) return "Never";
  const diff = Date.now() - parseUtc(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7)  return `${days} days ago`;
  return parseUtc(iso).toLocaleDateString("en-PH", { month:"short", day:"numeric" });
}

// ── Role cards used in modal ──────────────────────────────────────────────────

const ROLES = [
  { value:"ProjectManager",     label:"Project Manager",       icon:LayoutDashboard, desc:"Manage projects, view dashboards, approve procurement" },
  { value:"SiteEngineer",       label:"Site Engineer / PIC",   icon:TrendingUp,      desc:"Field data entry, record excess & waste, update progress"  },
  { value:"WarehousePersonnel", label:"Warehouse Personnel",   icon:Warehouse,       desc:"Manage inventory, track materials, handle movements"   },
  { value:"ProcurementOfficer", label:"Procurement Officer",   icon:ShoppingCart,    desc:"Manage POs, coordinate suppliers, approve deliveries"  },
  { value:"Admin",              label:"System Administrator",  icon:Shield,          desc:"Full system access, user management, backups"          },
];

// ── New User modal ────────────────────────────────────────────────────────────

function NewUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (u: UserRecord) => void }) {
  const [firstName,  setFirstName]  = useState("");
  const [lastName,   setLastName]   = useState("");
  const [email,      setEmail]      = useState("");
  const [phone,      setPhone]      = useState("");
  const [username,   setUsername]   = useState("");
  const [password,   setPassword]   = useState("");
  const [status,     setStatus]     = useState("Active");
  const [forceReset, setForceReset] = useState("Yes (Recommended)");
  const [role,       setRole]       = useState("ProjectManager");
  const [saving,     setSaving]     = useState(false);

  async function handleAdd() {
    if (!firstName || !lastName || !email || !username || !password) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    try {
      const pwd = password === "Auto-generate or enter"
        ? Math.random().toString(36).slice(-8) + "A1!"
        : password;
      const { data } = await api.post<UserRecord>("/users", {
        firstName, lastName, email, username,
        password: pwd,
        role,
        phoneNumber: phone || null,
      });
      toast.success(`User "${firstName} ${lastName}" created!`);
      onCreated(data);
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? "Failed to create user.");
    } finally {
      setSaving(false);
    }
  }

  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box" as const,
    background: "#fff", color: "#111827", border: "1px solid #e5e7eb",
    borderRadius: 8, padding: "9px 12px", fontSize: "0.875rem", outline: "none",
  };
  const label: React.CSSProperties = { fontSize: "0.65rem", color: "#9ca3af", marginBottom: 4, display: "block", fontWeight: 700, letterSpacing: "0.05em" };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:"1rem" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:600, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 24px 64px rgba(0,0,0,0.2)" }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:8, background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Users style={{ width:16, height:16, color:"#374151" }} />
            </div>
            <div>
              <p style={{ fontWeight:800, fontSize:"1rem" }}>New User</p>
              <p style={{ fontSize:"0.72rem", color:"#9ca3af" }}>Create account and assign role &amp; permissions</p>
            </div>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:18, height:18 }} /></button>
        </div>

        {/* Divider */}
        <hr style={{ border:"none", borderTop:"1px solid #f3f4f6", marginBottom:"1.25rem" }} />

        {/* Personal Information */}
        <p style={{ fontSize:"0.65rem", fontWeight:800, color:"#9ca3af", letterSpacing:"0.1em", marginBottom:"0.75rem" }}>PERSONAL INFORMATION</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem", marginBottom:"0.75rem" }}>
          <div><span style={label}>FIRST NAME *</span><input value={firstName} onChange={e=>setFirstName(e.target.value)} placeholder="e.g. Juan" style={inp} suppressHydrationWarning /></div>
          <div><span style={label}>LAST NAME *</span><input value={lastName} onChange={e=>setLastName(e.target.value)} placeholder="e.g. Dela Cruz" style={inp} suppressHydrationWarning /></div>
          <div><span style={label}>EMAIL ADDRESS *</span><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="user@constructiq.ph" style={inp} suppressHydrationWarning /></div>
          <div><span style={label}>PHONE NUMBER</span><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+ 63 9xx xxx xxxx" style={inp} suppressHydrationWarning /></div>
        </div>

        <hr style={{ border:"none", borderTop:"1px solid #f3f4f6", marginBottom:"1.25rem" }} />

        {/* Account Setup */}
        <p style={{ fontSize:"0.65rem", fontWeight:800, color:"#9ca3af", letterSpacing:"0.1em", marginBottom:"0.75rem" }}>ACCOUNT SETUP</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem", marginBottom:"0.75rem" }}>
          <div><span style={label}>USERNAME *</span><input value={username} onChange={e=>setUsername(e.target.value)} placeholder="e.g. j.delacruz" style={inp} suppressHydrationWarning /></div>
          <div><span style={label}>TEMPORARY PASSWORD *</span><input value={password} onChange={e=>setPassword(e.target.value)} placeholder="Auto-generate or enter" type="password" style={inp} suppressHydrationWarning /></div>
          <div>
            <span style={label}>ACCOUNT STATUS *</span>
            <select value={status} onChange={e=>setStatus(e.target.value)} style={{ ...inp, appearance:"none" as any, cursor:"pointer" }}>
              <option>Active</option><option>Inactive</option>
            </select>
          </div>
          <div>
            <span style={label}>FORCE PASSWORD RESET</span>
            <select value={forceReset} onChange={e=>setForceReset(e.target.value)} style={{ ...inp, appearance:"none" as any, cursor:"pointer" }}>
              <option>Yes (Recommended)</option><option>No</option>
            </select>
          </div>
        </div>

        <hr style={{ border:"none", borderTop:"1px solid #f3f4f6", marginBottom:"1.25rem" }} />

        {/* Role & Permissions */}
        <p style={{ fontSize:"0.65rem", fontWeight:800, color:"#9ca3af", letterSpacing:"0.1em", marginBottom:"0.75rem" }}>ROLE &amp; PERMISSIONS *</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.5rem", marginBottom:"1.25rem" }}>
          {ROLES.map(r => {
            const Icon = r.icon;
            const sel = role === r.value;
            return (
              <button key={r.value} onClick={()=>setRole(r.value)} style={{
                textAlign:"left", padding:"10px 12px", borderRadius:8, cursor:"pointer",
                border: sel ? "2px solid #f97316" : "1px solid #e5e7eb",
                background: sel ? "#fff7ed" : "#f9fafb",
                transition: "all 0.15s",
              }}>
                <p style={{ fontWeight:700, fontSize:"0.82rem", color: sel ? "#ea580c" : "#111827", marginBottom:2 }}>{r.label}</p>
                <p style={{ fontSize:"0.68rem", color:"#9ca3af", lineHeight:1.4 }}>{r.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <p style={{ fontSize:"0.72rem", color:"#9ca3af" }}>* Required fields</p>
          <div style={{ display:"flex", gap:"0.75rem" }}>
            <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
            <button onClick={handleAdd} disabled={saving} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Adding..." : "Add User"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── View User modal ───────────────────────────────────────────────────────────

function ViewUserModal({ user, onClose }: { user: UserRecord; onClose: () => void }) {
  const bg = avatarColor(`${user.firstName}${user.lastName}`);
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:440, boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem" }}>
          <p style={{ fontWeight:800, fontSize:"1rem" }}>User Profile</p>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:18, height:18 }} /></button>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:"1.25rem" }}>
          <div style={{ width:56, height:56, borderRadius:"50%", background:bg, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:700, fontSize:"1.2rem", flexShrink:0 }}>
            {initials(user.firstName, user.lastName)}
          </div>
          <div>
            <p style={{ fontWeight:700, fontSize:"1rem" }}>{user.firstName} {user.lastName}</p>
            <p style={{ fontSize:"0.8rem", color:"#9ca3af" }}>{ROLE_LABELS[user.role] ?? user.role}</p>
            <span style={{ fontSize:"0.65rem", fontWeight:700, padding:"2px 8px", borderRadius:999, background: user.isActive ? "#dcfce7" : "#f3f4f6", color: user.isActive ? "#15803d" : "#6b7280" }}>
              · {user.isActive ? "ACTIVE" : "INACTIVE"}
            </span>
          </div>
        </div>
        <hr style={{ border:"none", borderTop:"1px solid #f3f4f6", marginBottom:"1rem" }} />
        {[
          ["Username",    `@${user.username}`],
          ["Email",       user.email],
          ["Phone",       user.phoneNumber ?? "—"],
          ["Projects",    `${user.projectCount} assigned`],
          ["Last Login",  relativeTime(user.lastLogin)],
          ["Member Since",parseUtc(user.createdAt).toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" })],
        ].map(([k,v]) => (
          <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid #f9fafb" }}>
            <span style={{ fontSize:"0.78rem", color:"#9ca3af" }}>{k}</span>
            <span style={{ fontSize:"0.78rem", color:"#111827", fontWeight:500 }}>{v}</span>
          </div>
        ))}
        <div style={{ display:"flex", justifyContent:"flex-end", marginTop:"1.25rem" }}>
          <button onClick={onClose} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.875rem", fontWeight:600, cursor:"pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Edit User modal ───────────────────────────────────────────────────────────

function EditUserModal({ user, onClose, onUpdated }: { user: UserRecord; onClose: () => void; onUpdated: (u: UserRecord) => void }) {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName,  setLastName]  = useState(user.lastName);
  const [email,     setEmail]     = useState(user.email);
  const [phone,     setPhone]     = useState(user.phoneNumber ?? "");
  const [isActive,  setIsActive]  = useState(user.isActive);
  const [saving,    setSaving]    = useState(false);

  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box" as const,
    background: "#fff", color: "#111827", border: "1px solid #e5e7eb",
    borderRadius: 8, padding: "9px 12px", fontSize: "0.875rem", outline: "none",
  };
  const label: React.CSSProperties = { fontSize: "0.65rem", color: "#9ca3af", marginBottom: 4, display: "block", fontWeight: 700, letterSpacing: "0.05em" };

  async function handleSave() {
    setSaving(true);
    try {
      await api.put(`/users/${user.id}`, { firstName, lastName, email, role: user.role, isActive, phoneNumber: phone || null });
      toast.success("User updated.");
      onUpdated({ ...user, firstName, lastName, email, isActive, phoneNumber: phone || undefined });
      onClose();
    } catch {
      toast.error("Failed to update user.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:"1rem" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:600, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 24px 64px rgba(0,0,0,0.2)" }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:8, background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Pencil style={{ width:16, height:16, color:"#374151" }} />
            </div>
            <div>
              <p style={{ fontWeight:800, fontSize:"1rem" }}>Edit User</p>
              <p style={{ fontSize:"0.72rem", color:"#9ca3af" }}>{user.firstName} {user.lastName}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer" }}><X style={{ width:18, height:18 }} /></button>
        </div>

        <hr style={{ border:"none", borderTop:"1px solid #f3f4f6", marginBottom:"1.25rem" }} />

        {/* Personal Information */}
        <p style={{ fontSize:"0.65rem", fontWeight:800, color:"#9ca3af", letterSpacing:"0.1em", marginBottom:"0.75rem" }}>PERSONAL INFORMATION</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem", marginBottom:"0.75rem" }}>
          <div><span style={label}>FIRST NAME</span><input value={firstName} onChange={e=>setFirstName(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><span style={label}>LAST NAME</span><input value={lastName}  onChange={e=>setLastName(e.target.value)}  style={inp} suppressHydrationWarning /></div>
          <div><span style={label}>EMAIL ADDRESS</span><input value={email} onChange={e=>setEmail(e.target.value)} style={inp} suppressHydrationWarning /></div>
          <div><span style={label}>PHONE NUMBER</span><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+ 63 9xx xxx xxxx" style={inp} suppressHydrationWarning /></div>
        </div>

        <hr style={{ border:"none", borderTop:"1px solid #f3f4f6", marginBottom:"1.25rem" }} />

        {/* Account Status */}
        <p style={{ fontSize:"0.65rem", fontWeight:800, color:"#9ca3af", letterSpacing:"0.1em", marginBottom:"0.75rem" }}>ACCOUNT STATUS</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.5rem", marginBottom:"1.25rem" }}>
          {(["Active", "Inactive"] as const).map(s => {
            const sel = (isActive ? "Active" : "Inactive") === s;
            return (
              <button key={s} onClick={()=>setIsActive(s === "Active")} style={{
                textAlign:"left", padding:"10px 12px", borderRadius:8, cursor:"pointer",
                border: sel ? "2px solid #f97316" : "1px solid #e5e7eb",
                background: sel ? "#fff7ed" : "#f9fafb",
                transition: "all 0.15s",
              }}>
                <p style={{ fontWeight:700, fontSize:"0.82rem", color: sel ? "#ea580c" : "#111827" }}>{s}</p>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirm dialog ─────────────────────────────────────────────────────

function DeleteConfirm({ user, onClose, onDeleted }: { user: UserRecord; onClose: () => void; onDeleted: (id: number) => void }) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    try {
      await api.delete(`/users/${user.id}`);
      toast.success(`User "${user.firstName} ${user.lastName}" deleted.`);
      onDeleted(user.id);
      onClose();
    } catch {
      toast.error("Failed to delete user.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:400, boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <p style={{ fontWeight:800, fontSize:"1rem", marginBottom:"0.5rem" }}>Delete User</p>
        <p style={{ fontSize:"0.875rem", color:"#6b7280", marginBottom:"1.5rem" }}>
          Are you sure you want to delete <strong>{user.firstName} {user.lastName}</strong>? This action cannot be undone.
        </p>
        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleDelete} disabled={loading} style={{ padding:"9px 20px", borderRadius:8, border:"none", background:"#ef4444", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Modal =
  | { type:"new" }
  | { type:"view"; user:UserRecord }
  | { type:"edit"; user:UserRecord }
  | { type:"delete"; user:UserRecord }
  | null;

export default function UsersPage() {
  const [users,   setUsers]   = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState<Modal>(null);

  useEffect(() => {
    api.get<UserRecord[]>("/users")
      .then(r => setUsers(r.data))
      .catch(() => toast.error("Failed to load users."))
      .finally(() => setLoading(false));
  }, []);

  const activeCount = users.filter(u => u.isActive).length;

  return (
    <div style={{ background:"#f5f4f0", minHeight:"100vh" }}>
      {/* Modals */}
      {modal?.type === "new"    && <NewUserModal   onClose={()=>setModal(null)} onCreated={u=>setUsers(p=>[u,...p])} />}
      {modal?.type === "view"   && <ViewUserModal  user={modal.user} onClose={()=>setModal(null)} />}
      {modal?.type === "edit"   && <EditUserModal  user={modal.user} onClose={()=>setModal(null)} onUpdated={u=>setUsers(p=>p.map(x=>x.id===u.id?u:x))} />}
      {modal?.type === "delete" && <DeleteConfirm  user={modal.user} onClose={()=>setModal(null)} onDeleted={id=>setUsers(p=>p.filter(x=>x.id!==id))} />}

      <Header title="User Management" />

      <div style={{ padding:"1.25rem 1.5rem" }}>
        {/* Page header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:"1.5rem" }}>
          <div>
            <p style={{ fontWeight:800, fontSize:"1.4rem", color:"#111827" }}>All Users</p>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:2 }}>
              {loading ? "Loading..." : `${users.length} accounts registered`}
            </p>
          </div>
          <button onClick={()=>setModal({ type:"new" })} style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 20px", borderRadius:10, border:"none", background:"#f97316", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer" }}>
            <Plus style={{ width:16, height:16 }} /> Add User
          </button>
        </div>

        {/* Table card */}
        <div style={{ background:"#fff", borderRadius:14, boxShadow:"0 1px 3px rgba(0,0,0,0.07)", overflow:"hidden" }}>
          {loading ? (
            <div style={{ padding:"3rem", textAlign:"center", color:"#9ca3af" }}>Loading users…</div>
          ) : (
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid #f3f4f6" }}>
                  {["USER","ROLE","EMAIL","STATUS","PROJECTS","LAST LOGIN","ACTIONS"].map(h => (
                    <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontSize:"0.68rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.08em", whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const bg = avatarColor(`${u.firstName}${u.lastName}`);
                  return (
                    <tr key={u.id} style={{ borderBottom:"1px solid #f9fafb" }}>
                      {/* USER */}
                      <td style={{ padding:"14px 16px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                          <div style={{ width:38, height:38, borderRadius:"50%", background:bg, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:700, fontSize:"0.85rem", flexShrink:0 }}>
                            {initials(u.firstName, u.lastName)}
                          </div>
                          <span style={{ fontWeight:600, fontSize:"0.875rem", color:"#111827" }}>{u.firstName} {u.lastName}</span>
                        </div>
                      </td>
                      {/* ROLE */}
                      <td style={{ padding:"14px 16px", fontSize:"0.82rem", color:"#374151" }}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </td>
                      {/* EMAIL */}
                      <td style={{ padding:"14px 16px", fontSize:"0.82rem", color:"#6b7280" }}>
                        {u.email}
                      </td>
                      {/* STATUS */}
                      <td style={{ padding:"14px 16px" }}>
                        <span style={{
                          fontSize:"0.68rem", fontWeight:700, padding:"4px 10px", borderRadius:999,
                          background: u.isActive ? "#d1fae5" : "#f3f4f6",
                          color:      u.isActive ? "#065f46" : "#6b7280",
                        }}>
                          · {u.isActive ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      {/* PROJECTS */}
                      <td style={{ padding:"14px 16px", fontSize:"0.875rem", color:"#374151", textAlign:"center" }}>
                        {u.projectCount}
                      </td>
                      {/* LAST LOGIN */}
                      <td style={{ padding:"14px 16px", fontSize:"0.8rem", color:"#9ca3af", whiteSpace:"nowrap" }}>
                        {relativeTime(u.lastLogin)}
                      </td>
                      {/* ACTIONS */}
                      <td style={{ padding:"14px 16px" }}>
                        <div style={{ display:"flex", gap:8 }}>
                          <button onClick={()=>setModal({ type:"edit", user:u })} title="Edit" style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer", padding:4 }}>
                            <Pencil style={{ width:15, height:15 }} />
                          </button>
                          <button onClick={()=>setModal({ type:"view", user:u })} title="View" style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer", padding:4 }}>
                            <BookOpen style={{ width:15, height:15 }} />
                          </button>
                          <button onClick={()=>setModal({ type:"delete", user:u })} title="Delete" style={{ color:"#ef4444", background:"none", border:"none", cursor:"pointer", padding:4 }}>
                            <Trash2 style={{ width:15, height:15 }} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Empty state */}
          {!loading && users.length === 0 && (
            <div style={{ padding:"3rem", textAlign:"center", color:"#9ca3af" }}>
              <Users style={{ width:36, height:36, margin:"0 auto 0.75rem", opacity:0.3 }} />
              <p>No users found.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
