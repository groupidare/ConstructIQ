import Sidebar from "@/components/layout/Sidebar";
import { Toaster } from "react-hot-toast";
import PageDataLoader from "@/components/layout/PageDataLoader";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dashboard-layout" style={{ display: "flex", flexDirection: "row", height: "100vh", overflow: "hidden" }}>
      <Toaster position="top-right" />
      <Sidebar />
      {/* minWidth: 0 overrides a flex item's default min-width:auto — without
          it, this pane refuses to shrink below its content's intrinsic
          width, so widening the sidebar (or a wide inner grid) pushes this
          whole row wider than the viewport instead of letting content wrap
          or scroll internally. */}
      {/* The wrapper doesn't scroll, so the page preloader covers exactly the
          visible content area, whatever main is scrolled to. */}
      <div className="dashboard-content" style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative", display: "flex" }}>
        <main style={{ flex: 1, minWidth: 0, overflowY: "auto", overflowX: "hidden", minHeight: 0 }}>
          {children}
        </main>
        <PageDataLoader />
      </div>
    </div>
  );
}
