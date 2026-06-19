import Header from "@/components/layout/Header";

export default function SettingsPage() {
  return (
    <div>
      <Header title="System Settings" />
      <div className="p-6">
        <div className="card">
          <p className="text-sm text-gray-400">Configure material categories, unit types, thresholds, and system preferences.</p>
        </div>
      </div>
    </div>
  );
}
