"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import Button from "@/components/ui/Button";

interface ActivityLog {
  id: number; userDisplay: string; action: string; details?: string; entityType?: string; ipAddress?: string; createdAt: string;
}

export default function ActivityLogView() {
  const isAdmin = useAuthStore(s => s.user?.role === "Admin");
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("All");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    async function load() {
      try {
        const { data } = await api.get("/v1/activity-logs", { params: { page, pageSize: 15, search, action }, signal: controller.signal });
        setLogs(data.items); setTotal(data.total); setError("");
      } catch {
        if (!controller.signal.aborted) { setLogs([]); setTotal(0); setError("Activity could not be loaded. Try Refresh."); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    setLoading(true); void load();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 10000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [isAdmin, page, search, action, refresh]);
  if (!isAdmin) return <p>Administrator access required.</p>;
  return <div className="space-y-4">
    <div className="flex gap-2 flex-wrap">
      <input aria-label="Search activity" className="input flex-1" placeholder="Search user, action, details…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <select aria-label="Filter activity" className="input w-auto" value={action} onChange={e => { setAction(e.target.value); setPage(1); }}>
        {["All", "POST", "PUT", "PATCH", "DELETE", "LOGIN", "PASSWORD", "MFA", "BACKUP", "RESTORED"].map(a => <option key={a}>{a}</option>)}
      </select>
      <Button variant="secondary" onClick={() => setRefresh(v => v + 1)}>Refresh</Button>
    </div>
    <p className="text-sm text-gray-600">{total} matching events · Updates every 10 seconds</p>
    {error ? <p role="alert" className="text-red-600">{error}</p> : loading ? <p>Loading activity…</p> : logs.length === 0 ? <p>No activity recorded</p> :
      <div className="overflow-auto max-h-96"><table className="w-full text-left text-sm"><thead><tr>{["Time", "User", "Action", "Details", "IP"].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead>
        <tbody>{logs.map(log => <tr className="border-t" key={log.id}><td className="p-2 whitespace-nowrap">{new Date(log.createdAt.endsWith("Z") ? log.createdAt : log.createdAt + "Z").toLocaleString()}</td><td className="p-2">{log.userDisplay}</td><td className="p-2">{log.action}</td><td className="p-2">{log.details ?? "—"}</td><td className="p-2">{log.ipAddress ?? "—"}</td></tr>)}</tbody>
      </table></div>}
    <div className="flex items-center gap-3"><Button variant="secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span>Page {page} / {Math.max(1, Math.ceil(total / 15))}</span><Button variant="secondary" disabled={page * 15 >= total} onClick={() => setPage(p => p + 1)}>Next</Button></div>
  </div>;
}
