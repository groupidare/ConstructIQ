"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import { useAuthStore } from "@/store/authStore";
import { Avatar } from "@/components/ui/Avatar";
import api from "@/lib/api";
import { ChangePasswordModal, MFAModal, BackupModal } from "@/components/auth/SecurityModals";
import ActivityLogView from "@/components/auth/ActivityLogView";
import Modal from "@/components/ui/Modal";
import {
  Lock, Shield, CloudUpload, Database, ChevronRight,
  LogOut, Pencil, X,
  Camera, Trash2, Loader2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  Admin:              "System Administrator",
  ProjectManager:     "Project Manager",
  SiteEngineer:       "Site Engineer / PIC",
  WarehousePersonnel: "Warehouse Personnel",
  ProcurementOfficer: "Procurement Officer",
};

const DEPT_MAP: Record<string, string> = {
  Admin:              "Construction Management",
  ProjectManager:     "Project Operations",
  SiteEngineer:       "Site Engineering",
  WarehousePersonnel: "Warehouse & Logistics",
  ProcurementOfficer: "Procurement & Supply",
};

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

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

function EditProfileModal({ onClose }: { onClose: () => void }) {
  const user       = useAuthStore(s => s.user);
  const updateUser = useAuthStore(s => s.updateUser);
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName,  setLastName]  = useState(user?.lastName  ?? "");
  const [saving,    setSaving]    = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`.toUpperCase();

  // Avatar changes are staged locally and only sent to the server when
  // "Save Changes" is clicked, so "Cancel" genuinely discards them — same
  // as the name fields already do. Email is intentionally not editable here.
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
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First name and last name are required.");
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
        firstName: firstName.trim(), lastName: lastName.trim(),
      });
      updateUser({
        firstName: data.firstName, lastName: data.lastName,
        ...(newAvatarUrl !== undefined ? { avatarUrl: newAvatarUrl } : {}),
      });
      toast.success("Profile updated.");
      onClose();
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to update profile.");
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
                <Loader2 style={{ width:20, height:20, color:"#fff", animation:"spin 1s linear infinite" }} />
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
        </div>
        <div style={{ display:"flex", gap:"0.75rem", justifyContent:"flex-end", marginTop:"1rem" }}>
          <button onClick={handleCancel} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#111827", color:"#fff", fontSize:"0.875rem", fontWeight:700, cursor:"pointer", opacity:saving?0.7:1 }}>
            {saving ? "Saving…" : "Save Changes"}
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
    aiForecastUpdates: true,
  });

  function handleSignOut() {
    logout();
    router.push("/");
  }

  function confirmSignOut() { setModal("signOutConfirm"); }

  const fullName = user ? `${user.firstName} ${user.lastName}` : "";
  const roleLabel = ROLE_LABELS[user?.role ?? ""] ?? "User";
  const dept = DEPT_MAP[user?.role ?? ""] ?? "—";
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
      {user?.role === "Admin" && modal === "backup" && <BackupModal         onClose={()=>setModal(null)} />}
      {user?.role === "Admin" && modal === "activityLog" && <Modal open title="Activity Log" size="xl" onClose={()=>setModal(null)}><ActivityLogView /></Modal>}
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
            <div>
              <p style={{ fontSize:"0.78rem", color:"#374151", fontWeight:600, marginBottom:6 }}>Department</p>
              <input readOnly value={dept} style={readonlyField} suppressHydrationWarning />
            </div>
          </div>
        </Card>

        {/* ── Notification Preferences ── */}
        <Card title="Notification Preferences">
          {([
            ["shortageAlerts",    "Shortage Alerts",       "Get notified when materials reach critical levels"],
            ["overstockWarnings", "Overstock Warnings",    "Alerts for materials exceeding maximum thresholds"],
            ["deliveryUpdates",   "Delivery Updates",      "Track procurement order status changes"],
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
          {user?.role === "Admin" && <SecRow icon={CloudUpload} label="Backup and Restore" onClick={()=>setModal("backup")} />}
          {user?.role === "Admin" && <SecRow icon={Database} label="Activity Log" onClick={()=>setModal("activityLog")} />}
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
