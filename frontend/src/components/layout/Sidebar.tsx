"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/auth";
import {
  LayoutDashboard, FolderKanban, Package, TrendingUp,
  BarChart3, ShoppingCart, ArrowLeftRight, FileText,
  Users, Settings, Activity, LogOut,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard",        href: "/",                   icon: LayoutDashboard, roles: ["Admin","ProjectManager","SiteEngineer","WarehousePersonnel","ProcurementOfficer"] },
  { label: "Projects",         href: "/projects",           icon: FolderKanban,    roles: ["Admin","ProjectManager","SiteEngineer"] },
  { label: "Inventory",        href: "/inventory",          icon: Package,         roles: ["Admin","ProjectManager","SiteEngineer","WarehousePersonnel"] },
  { label: "Forecasting",      href: "/forecasting",        icon: TrendingUp,      roles: ["Admin","ProjectManager","SiteEngineer"] },
  { label: "Excess Analytics", href: "/excess-analytics",   icon: BarChart3,       roles: ["Admin","ProjectManager","SiteEngineer","WarehousePersonnel"] },
  { label: "Procurement",      href: "/procurement",        icon: ShoppingCart,    roles: ["Admin","ProjectManager","ProcurementOfficer"] },
  { label: "Redistribution",   href: "/redistribution",     icon: ArrowLeftRight,  roles: ["Admin","ProjectManager","WarehousePersonnel"] },
  { label: "Reports",          href: "/reports",            icon: FileText,        roles: ["Admin","ProjectManager"] },
  { label: "Users",            href: "/admin/users",        icon: Users,           roles: ["Admin"] },
  { label: "Activity Logs",    href: "/admin/activity-logs",icon: Activity,        roles: ["Admin"] },
  { label: "Settings",         href: "/admin/settings",     icon: Settings,        roles: ["Admin"] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  const visibleItems = NAV_ITEMS.filter(
    (item) => user && item.roles.includes(user.role)
  );

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-16 items-center border-b border-gray-200 px-6">
        <span className="text-xl font-bold text-primary-700">ConstructIQ</span>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-200 p-4">
        <div className="mb-3 px-3">
          <p className="text-sm font-medium text-gray-900">
            {user?.firstName} {user?.lastName}
          </p>
          <p className="text-xs text-gray-500">{user?.role}</p>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
