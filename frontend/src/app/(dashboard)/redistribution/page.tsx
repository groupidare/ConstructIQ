"use client";

import { Fragment, useEffect, useState } from "react";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import { useAuthStore } from "@/store/authStore";
import { useProcurement } from "@/hooks/useProcurement";
import { UNDECIDED_STATUSES, buildProjectOverviews, movementsOf, type ProjectOverview } from "@/lib/redistributionMovements";
import { Package, ClipboardCheck, Repeat, CheckSquare, X, ChevronDown, ChevronRight, ArrowUpRight, ArrowDownLeft, LayoutList } from "lucide-react";

// The movements themselves come from lib/redistributionMovements. Read-only,
// apart from the transfers still waiting for a decision: each one holds its
// excess until someone approves or rejects it.

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const OVERVIEW_TH: React.CSSProperties = { textAlign: "left", fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", padding: "0.6rem 0.75rem", whiteSpace: "nowrap" };
const OVERVIEW_TD: React.CSSProperties = { fontSize: "0.8rem", color: "#374151", padding: "0.7rem 0.75rem", borderTop: "1px solid #f3f4f6" };

function RedistributionOverview({ overviews }: { overviews: ProjectOverview[] }) {
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());

  function toggle(projectId: number) {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (!next.delete(projectId)) next.add(projectId);
      return next;
    });
  }

  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <LayoutList style={{ width: 16, height: 16, color: "#f97316" }} />
        <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Redistribution Overview per Project</span>
      </div>
      <p style={{ fontSize: "0.78rem", color: "#9ca3af", marginBottom: "1rem" }}>Logged excess that went to another project, showing what each project sent out and received</p>

      {overviews.length === 0 ? (
        <p style={{ textAlign: "center", color: "#9ca3af", fontSize: "0.85rem", padding: "2rem 0" }}>
          No materials have been redistributed yet — excess the warehouse releases to another project will appear here.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr>
                <th style={OVERVIEW_TH}>PROJECT</th>
                <th style={OVERVIEW_TH}>SENT OUT</th>
                <th style={OVERVIEW_TH}>RECEIVED</th>
                <th style={OVERVIEW_TH}>LAST MOVEMENT</th>
                <th style={OVERVIEW_TH}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {overviews.map(o => {
                const open = openIds.has(o.projectId);
                const Chevron = open ? ChevronDown : ChevronRight;
                return (
                  <Fragment key={o.projectId}>
                    <tr>
                      <td style={{ ...OVERVIEW_TD, fontWeight: 700, color: "#111827", fontSize: "0.88rem" }}>{o.projectName}</td>
                      <td style={OVERVIEW_TD}>{o.sentCount}</td>
                      <td style={OVERVIEW_TD}>{o.receivedCount}</td>
                      <td style={OVERVIEW_TD}>{formatDate(o.movements[0].movement.at)}</td>
                      <td style={OVERVIEW_TD}>
                        <button onClick={() => toggle(o.projectId)} aria-expanded={open} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}>
                          <Chevron style={{ width: 14, height: 14 }} /> View
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={5} style={{ padding: "0 0 0.75rem", background: "#f9fafb" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr>
                                <th style={OVERVIEW_TH}>DATE</th>
                                <th style={OVERVIEW_TH}>MATERIAL</th>
                                <th style={OVERVIEW_TH}>MOVEMENT</th>
                                <th style={OVERVIEW_TH}>PROJECT</th>
                                <th style={OVERVIEW_TH}>QTY</th>
                                <th style={OVERVIEW_TH}>UNIT</th>
                              </tr>
                            </thead>
                            <tbody>
                              {o.movements.map(({ movement: m, sent, otherProject }) => {
                                const Arrow = sent ? ArrowUpRight : ArrowDownLeft;
                                return (
                                  <tr key={`${m.key}-${sent ? "sent" : "received"}`}>
                                    <td style={{ ...OVERVIEW_TD, whiteSpace: "nowrap" }}>{formatDate(m.at)}</td>
                                    <td style={{ ...OVERVIEW_TD, fontWeight: 600, color: "#111827" }}>{m.materialName}</td>
                                    <td style={OVERVIEW_TD}>
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.68rem", fontWeight: 700, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", background: sent ? "#fff7ed" : "#dcfce7", color: sent ? "#c2410c" : "#15803d" }}>
                                        <Arrow style={{ width: 12, height: 12 }} /> {sent ? "Sent to" : "Received from"}
                                      </span>
                                    </td>
                                    <td style={OVERVIEW_TD}>{otherProject}</td>
                                    <td style={OVERVIEW_TD}>{m.quantity.toLocaleString()}</td>
                                    <td style={{ ...OVERVIEW_TD, color: "#9ca3af" }}>{m.unit}</td>
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
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RedistributionPage() {
  const { redistribution, excessReleases, fetchRedistribution, fetchExcessReleases, approveTransfer, rejectTransfer } = useProcurement(0);

  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);

  // Mirrors the backend: only Admin/WarehousePersonnel can approve or reject —
  // ProjectManager's Redistribution access is view-only.
  const { user } = useAuthStore();
  const role = user?.role;
  const canManageRedistribution = role === "Admin" || role === "WarehousePersonnel";

  useEffect(() => {
    Promise.all([fetchRedistribution(), fetchExcessReleases()])
      .catch(() => toast.error("Couldn't load redistributions. Check that the backend is running, then reload."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const movements = movementsOf(redistribution, excessReleases);
  const overviews = buildProjectOverviews(movements);
  const undecided = redistribution.filter(r => UNDECIDED_STATUSES.includes(r.status));

  const approveFailure = (error: unknown) =>
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Failed to approve transfer.";

  async function handleApprove(id: number) {
    setApprovingId(id);
    try {
      await approveTransfer(id);
      toast.success("Transfer approved.");
    } catch (error) {
      toast.error(approveFailure(error));
    } finally {
      setApprovingId(null);
    }
  }

  async function handleReject(id: number) {
    if (!window.confirm("Reject this transfer? Its excess becomes available to the warehouse again.")) return;
    setRejectingId(id);
    try {
      await rejectTransfer(id);
      toast.success("Transfer rejected.");
    } catch {
      toast.error("Failed to reject transfer.");
    } finally {
      setRejectingId(null);
    }
  }

  return (
    <div style={{ background: "#f5f4f0" }}>
      <Header title="Redistribution" />

      <div className="responsive-page" style={{ padding: "1.25rem 1.5rem" }}>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
          {[
            { icon: Repeat,         color: "#0d9488", bg: "#ccfbf1", label: "Materials Redistributed", value: String(movements.length) },
            { icon: Package,        color: "#b45309", bg: "#fef3c7", label: "Projects That Sent Excess", value: String(overviews.filter(o => o.sentCount > 0).length) },
            { icon: ClipboardCheck, color: "#15803d", bg: "#dcfce7", label: "Projects That Received", value: String(overviews.filter(o => o.receivedCount > 0).length) },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} style={{ background: "#fff", borderRadius: 14, padding: "1.5rem 1.5rem 1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                <div style={{ width: 44, height: 44, borderRadius: 11, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.875rem" }}>
                  <Icon style={{ width: 22, height: 22, color: s.color }} />
                </div>
                <p style={{ fontSize: "1.7rem", fontWeight: 800, color: "#111827", lineHeight: 1 }}>{s.value}</p>
                <p style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: 4 }}>{s.label}</p>
              </div>
            );
          })}
        </div>

        {/* Only while some are left: new excess moves through the warehouse instead. */}
        {undecided.length > 0 && (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
            <p style={{ fontWeight: 700, fontSize: "0.9rem", color: "#111827" }}>{undecided.length} transfer{undecided.length === 1 ? "" : "s"} waiting for a decision</p>
            <p style={{ fontSize: "0.78rem", color: "#6b7280", margin: "2px 0 0.5rem" }}>Each one holds its excess until it's approved or rejected, so the warehouse can't release it.</p>
            {undecided.map(r => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "0.6rem 0", borderTop: "1px solid #fed7aa", flexWrap: "wrap" }}>
                <p style={{ fontSize: "0.8rem", color: "#374151" }}>
                  <b style={{ color: "#111827" }}>{r.materialName}</b> · {r.transferQuantity.toLocaleString()} {r.unit} · {r.sourceProjectName} → {r.targetProjectName}
                </p>
                {canManageRedistribution && (
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button onClick={() => handleApprove(r.id)} disabled={approvingId === r.id}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontSize: "0.78rem", fontWeight: 600, cursor: approvingId === r.id ? "default" : "pointer" }}>
                      <CheckSquare style={{ width: 13, height: 13 }} /> {approvingId === r.id ? "Approving…" : "Approve"}
                    </button>
                    <button onClick={() => handleReject(r.id)} disabled={rejectingId === r.id}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff", color: "#dc2626", fontSize: "0.78rem", fontWeight: 600, cursor: rejectingId === r.id ? "default" : "pointer" }}>
                      <X style={{ width: 13, height: 13 }} /> {rejectingId === r.id ? "Rejecting…" : "Reject"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <RedistributionOverview overviews={overviews} />
      </div>
    </div>
  );
}
