"use client";

import { Bell } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

interface HeaderProps {
  title: string;
}

export default function Header({ title }: HeaderProps) {
  const user = useAuthStore((s) => s.user);
  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      <div className="flex items-center gap-4">
        <button className="relative rounded-full p-1.5 text-gray-500 hover:bg-gray-100">
          <Bell className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <span className="text-sm font-medium text-gray-700">
            {user?.firstName} {user?.lastName}
          </span>
        </div>
      </div>
    </header>
  );
}
