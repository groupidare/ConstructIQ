import Sidebar from "@/components/layout/Sidebar";
import { Toaster } from "react-hot-toast";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", height: "100vh", overflow: "hidden" }}>
      <Toaster position="top-right" />
      <Sidebar />
      <main style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {children}
      </main>
    </div>
  );
}
