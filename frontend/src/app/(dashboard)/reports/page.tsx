import Header from "@/components/layout/Header";

export default function ReportsPage() {
  return (
    <div>
      <Header title="Reports" />
      <div className="p-6">
        <div className="card">
          <p className="text-sm text-gray-400">Forecast accuracy reports and material usage analytics.</p>
        </div>
      </div>
    </div>
  );
}
