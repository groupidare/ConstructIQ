import { PreloaderVideo } from "@/components/layout/Preloader";

// Moving between pages (Projects → Procurement…): shown in the content area,
// beside the sidebar, while the next page loads. It fades in only after a
// moment, so a page that opens instantly doesn't flash it.
export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading"
      style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff",
        animation: "preloader-fade-in 0.3s ease 0.25s both" }}>
      <PreloaderVideo width="min(560px, 100%)" />
    </div>
  );
}
