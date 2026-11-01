"use client";

import ActivityLogView from "@/components/auth/ActivityLogView";

export default function ActivityLogsPage() {
  return <div className="p-6 space-y-4"><h1 className="text-2xl font-bold">Activity Logs</h1><ActivityLogView /></div>;
}