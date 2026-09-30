"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import toast from "react-hot-toast";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

function errorMessage(error: unknown): string {
  return axios.isAxiosError(error) ? error.response?.data?.message ?? "Request failed. Please try again." : "Request failed. Please try again.";
}

function SecurityModal({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  return <Modal open title={title} onClose={() => { if (!busy) onClose(); }}><div className="space-y-4">{children}</div></Modal>;
}

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [stage, setStage] = useState<"request" | "verify" | "password">("request");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const logout = useAuthStore(s => s.logout);
  const router = useRouter();

  async function requestCode() {
    setBusy(true); setError(""); setToken("");
    try {
      await api.post("/v1/auth/change-password/request-otp");
      setCode(""); setStage("verify");
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true); setError("");
    try {
      const { data } = await api.post<{ password_change_token: string }>("/v1/auth/change-password/verify-otp", { code });
      setToken(data.password_change_token); setStage("password");
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  async function save() {
    if (password.length < 8 || password !== confirm || new TextEncoder().encode(password).length > 72) {
      setError("Passwords must match, contain at least 8 characters, and use at most 72 UTF-8 bytes."); return;
    }
    setBusy(true); setError("");
    try {
      const { data } = await api.post("/v1/auth/change-password", { passwordChangeToken: token, newPassword: password, confirmPassword: confirm });
      toast.success(data.message); logout(); router.replace("/login");
    } catch (err) {
      setError(errorMessage(err));
      // Every authorization failure requires a fresh challenge; never keep an expired grant.
      if (axios.isAxiosError(err) && err.response?.status === 400) { setToken(""); setStage("request"); }
    } finally { setBusy(false); }
  }

  return <SecurityModal title="Change Password" onClose={onClose} busy={busy}>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {stage === "request" && <><p className="text-sm text-gray-600">Verify your identity using a code sent to your registered email.</p><Button loading={busy} onClick={requestCode}>Send code to change password</Button></>}
    {stage === "verify" && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void verify(); }}>
      <p className="text-sm text-gray-600">Enter the six-digit email code. It expires in five minutes.</p>
      <Input aria-label="Verification code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} required />
      <Button type="submit" loading={busy} disabled={code.length !== 6}>Verify code</Button>
      <Button type="button" variant="ghost" disabled={busy} onClick={requestCode}>Resend code</Button>
    </form>}
    {stage === "password" && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }}>
      <p className="text-sm text-gray-600">Identity verified. Set your new password within five minutes. You will be signed out on all devices.</p>
      <Input aria-label="New password" placeholder="New password" autoComplete="new-password" type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} />
      <Input aria-label="Confirm password" placeholder="Confirm password" autoComplete="new-password" type="password" minLength={8} required value={confirm} onChange={e => setConfirm(e.target.value)} />
      <Button type="submit" loading={busy}>Save password</Button>
    </form>}
  </SecurityModal>;
}

export function MFAModal({ onClose }: { onClose: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const updateUser = useAuthStore(s => s.updateUser);
  useEffect(() => {
    api.get("/v1/auth/mfa").then(({ data }) => { setEnabled(data.isMfaEnabled); updateUser({ mfaEnabled: data.isMfaEnabled }); })
      .catch(err => setError(errorMessage(err)));
  }, [updateUser]);
  async function toggle() {
    setBusy(true); setError("");
    try {
      const { data } = await api.post(`/v1/auth/mfa/${enabled ? "disable" : "enable"}`);
      setEnabled(data.isMfaEnabled); updateUser({ mfaEnabled: data.isMfaEnabled });
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <SecurityModal title="Multi-Factor Authentication" onClose={onClose} busy={busy}>
    <h3 className="font-semibold">Email Verification Codes</h3>
    <p className="text-sm text-gray-600">When enabled, each sign-in requires a six-digit code sent to your registered email. New devices require email verification even when this setting is disabled.</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <button type="button" role="switch" aria-label="Email multi-factor authentication" aria-checked={enabled === true} disabled={enabled === null || busy}
      onClick={toggle} className="btn-secondary disabled:opacity-50">{busy ? "Saving…" : enabled === null ? "Loading…" : enabled ? "Enabled — click to disable" : "Disabled — click to enable"}</button>
  </SecurityModal>;
}

export function BackupModal({ onClose }: { onClose: () => void }) {
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const logout = useAuthStore(s => s.logout);
  const router = useRouter();
  async function status() {
    const { data } = await api.get("/v1/system/backup"); setLastBackup(data.createdAt); setLoaded(true);
  }
  useEffect(() => { status().catch(err => setError(errorMessage(err))); }, []);
  async function backup() {
    setBusy(true); setError("");
    try {
      const response = await api.post("/v1/system/backup", {}, { responseType: "blob", timeout: 180000 });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a"); link.href = url;
      link.download = /filename="?([^";]+)"?/.exec(response.headers["content-disposition"] ?? "")?.[1] ?? "constructiq-backup.json";
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      await status();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
        try { setError(JSON.parse(await err.response.data.text()).message); } catch { setError("Backup failed."); }
      } else setError(errorMessage(err));
    } finally { setBusy(false); }
  }
  async function restore() {
    if (!file || confirmation !== "RESTORE") return;
    if (file.size > 50 * 1024 * 1024) { setError("Backup must be 50 MB or smaller."); return; }
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("file", file); form.append("confirmation", confirmation);
      const { data } = await api.post("/v1/system/restore", form, { headers: { "Content-Type": undefined }, timeout: 180000 });
      toast.success(data.message); logout(); router.replace("/login");
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <SecurityModal title="Backup and Restore" onClose={onClose} busy={busy}>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <p className="text-sm">Last backup generated: {lastBackup ? new Date(lastBackup.endsWith("Z") ? lastBackup : lastBackup + "Z").toLocaleString() : loaded ? "No backup recorded" : "Loading…"}</p>
    <p className="text-sm text-gray-600">This downloads the database, including sensitive account data. Store it securely. Uploaded documents and photos require a separate file backup.</p>
    <Button loading={busy} onClick={backup}>Download database backup</Button>
    <hr />
    <p className="text-sm text-red-700">Restore replaces all database records and signs everyone out. Download a current backup first. Only backups from this installation with a matching schema can be restored.</p>
    <input aria-label="Backup file" type="file" accept=".json" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} />
    <Input aria-label="Type RESTORE to confirm" placeholder="Type RESTORE to confirm" value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} />
    <Button variant="danger" disabled={busy || !file || confirmation !== "RESTORE"} onClick={restore}>Restore database</Button>
  </SecurityModal>;
}
