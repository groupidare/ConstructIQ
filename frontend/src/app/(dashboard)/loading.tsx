import { PRELOADER_OVERLAY, PreloaderLogo } from "@/components/layout/Preloader";

// Moving between pages (Projects → Procurement…): covers the screen while
// the next page's code loads (PageDataLoader then covers its data). It fades in only after a
// moment, so a page that opens instantly doesn't flash it.
export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading"
      style={{ ...PRELOADER_OVERLAY, zIndex: 950,
        animation: "preloader-fade-in 0.3s ease 0.25s both" }}>
      <PreloaderLogo />
    </div>
  );
}
