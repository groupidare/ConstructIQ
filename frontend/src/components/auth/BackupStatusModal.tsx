"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

interface BackupJobRun {
  id: number;
  jobType: string;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  localSuccess: boolean | null;
  cloudSuccess: boolean | null;
  fullChainTag: string | null;
  bytesProcessed: number | null;
  errorMessage: string | null;
}

interface BackupStatus {
  lastSuccessfulLocalBackup: string | null;
  lastSuccessfulCloudCopy: string | null;
  lastSuccessfulFullBackup: string | null;
  latestIncrementalRecoveryPoint: string | null;
  lastRestoreVerification: string | null;
  arrangementStatus: "Complete" | "MissingLocalDevice" | "MissingCloudDestination" | "NeverRun";
  recentJobs: BackupJobRun[];
}

function errorMessage(error: unknown): string {
  return axios.isAxiosError(error) ? error.response?.data?.message ?? "Request failed." : "Request failed.";
}

function fmt(value: string | null): string {
  if (!value) return "Never";
  const d = new Date(value.endsWith("Z") ? value : value + "Z");
  return d.toLocaleString();
}

const STATUS_META: Record<BackupStatus["arrangementStatus"], { label: string; color: string; bg: string }> = {
  Complete:                 { label: "3-2-1 arrangement complete",        color: "#15803d", bg: "#dcfce7" },
  MissingLocalDevice:       { label: "Missing: local device backup (Copy 2)", color: "#b45309", bg: "#fef3c7" },
  MissingCloudDestination:  { label: "Missing: off-site cloud copy (Copy 3)", color: "#b45309", bg: "#fef3c7" },
  NeverRun:                 { label: "No backup has ever run",            color: "#b91c1c", bg: "#fee2e2" },
};

function outcomeBadge(success: boolean | null): { label: string; color: string } {
  if (success === true) return { label: "OK", color: "#15803d" };
  if (success === false) return { label: "Failed", color: "#b91c1c" };
  return { label: "N/A", color: "#9ca3af" };
}

export default function BackupStatusModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [triggering, setTriggering] = useState<"DailyIncremental" | "WeeklyFull" | null>(null);

  async function load() {
    try {
      const { data } = await api.get<BackupStatus>("/v1/system/backup-jobs/status");
      setStatus(data);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function trigger(jobType: "DailyIncremental" | "WeeklyFull") {
    setTriggering(jobType);
    try {
      const { data } = await api.post<{ message: string }>("/v1/system/backup-jobs/trigger", { jobType });
      toast.success(data.message);
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setTriggering(null); }
  }

  const meta = status ? STATUS_META[status.arrangementStatus] : null;

  return (
    <Modal open title="Backup & Disaster Recovery" onClose={onClose} size="lg">
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : status && meta ? (
          <>
            <div style={{ padding: "0.6rem 0.9rem", borderRadius: 8, background: meta.bg, color: meta.color, fontWeight: 700, fontSize: "0.82rem" }}>
              {meta.label}
            </div>
            <p style={{ fontSize: "0.72rem", color: "#9ca3af", margin: 0 }}>
              This reflects real recorded job outcomes only — never inferred from configuration alone.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", fontSize: "0.82rem" }}>
              <div><strong>Last local backup:</strong><br />{fmt(status.lastSuccessfulLocalBackup)}</div>
              <div><strong>Last cloud copy:</strong><br />{fmt(status.lastSuccessfulCloudCopy)}</div>
              <div><strong>Last full backup:</strong><br />{fmt(status.lastSuccessfulFullBackup)}</div>
              <div><strong>Latest incremental recovery point:</strong><br />{fmt(status.latestIncrementalRecoveryPoint)}</div>
              <div style={{ gridColumn: "1 / -1" }}><strong>Last restore verification:</strong><br />{fmt(status.lastRestoreVerification)}</div>
            </div>

            <hr />

            <div style={{ display: "flex", gap: "0.6rem" }}>
              <Button loading={triggering === "DailyIncremental"} disabled={triggering !== null} onClick={() => trigger("DailyIncremental")}>
                Run daily incremental now
              </Button>
              <Button loading={triggering === "WeeklyFull"} disabled={triggering !== null} onClick={() => trigger("WeeklyFull")}>
                Run weekly full now
              </Button>
            </div>
            <p style={{ fontSize: "0.72rem", color: "#9ca3af", margin: 0 }}>
              Requests the scheduled task to run immediately and returns right away — the job runs in the background and reports back here once finished.
            </p>

            <hr />

            <p style={{ fontWeight: 700, fontSize: "0.82rem", margin: 0 }}>Recent job history</p>
            <div style={{ maxHeight: 240, overflowY: "auto" }}>
              {status.recentJobs.length === 0 ? (
                <p className="text-sm text-gray-500">No jobs recorded yet.</p>
              ) : (
                <table style={{ width: "100%", fontSize: "0.75rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#9ca3af" }}>
                      <th style={{ padding: "4px 6px" }}>When</th>
                      <th style={{ padding: "4px 6px" }}>Type</th>
                      <th style={{ padding: "4px 6px" }}>Local</th>
                      <th style={{ padding: "4px 6px" }}>Cloud</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.recentJobs.map(job => {
                      const local = outcomeBadge(job.localSuccess);
                      const cloud = outcomeBadge(job.cloudSuccess);
                      return (
                        <tr key={job.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "4px 6px" }}>{fmt(job.startedAt)}</td>
                          <td style={{ padding: "4px 6px" }}>{job.jobType} ({job.trigger})</td>
                          <td style={{ padding: "4px 6px", color: local.color, fontWeight: 700 }}>{local.label}</td>
                          <td style={{ padding: "4px 6px", color: cloud.color, fontWeight: 700 }}>{cloud.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {status.recentJobs.some(j => j.errorMessage) && (
              <details>
                <summary style={{ fontSize: "0.75rem", color: "#b91c1c", cursor: "pointer" }}>View failure details</summary>
                {status.recentJobs.filter(j => j.errorMessage).map(j => (
                  <p key={j.id} style={{ fontSize: "0.7rem", color: "#b91c1c", margin: "4px 0" }}>{fmt(j.startedAt)}: {j.errorMessage}</p>
                ))}
              </details>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
