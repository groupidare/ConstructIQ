import Header from "@/components/layout/Header";
import { Package, TrendingUp, AlertTriangle, ShoppingCart } from "lucide-react";

const stats = [
  { label: "Active Projects",    value: "—", icon: Package,       color: "text-blue-600",   bg: "bg-blue-50" },
  { label: "Forecasts Generated",value: "—", icon: TrendingUp,    color: "text-green-600",  bg: "bg-green-50" },
  { label: "Excess Alerts",      value: "—", icon: AlertTriangle, color: "text-orange-600", bg: "bg-orange-50" },
  { label: "Pending POs",        value: "—", icon: ShoppingCart,  color: "text-purple-600", bg: "bg-purple-50" },
];

export default function DashboardPage() {
  return (
    <div>
      <Header title="Dashboard" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="card flex items-center gap-4">
                <div className={`rounded-lg p-3 ${s.bg}`}>
                  <Icon className={`h-6 w-6 ${s.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                  <p className="text-sm text-gray-500">{s.label}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Recent Material Forecasts</h2>
            <p className="text-sm text-gray-400">No forecasts yet. Create a project and run forecasting.</p>
          </div>
          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Inventory Alerts</h2>
            <p className="text-sm text-gray-400">No alerts at this time.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
