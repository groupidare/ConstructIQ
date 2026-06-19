"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import type { LoginResponse } from "@/types/auth";
import toast from "react-hot-toast";
import {
  Loader2, User, Lock, TrendingUp, Box, ShieldCheck,
  BarChart2, MapPin, Shield, Package, ShoppingCart, Info,
} from "lucide-react";

const ROLES = [
  { label: "Project Manager", value: "ProjectManager", icon: BarChart2 },
  { label: "Site",            value: "SiteEngineer",        icon: MapPin },
  { label: "Admin",           value: "Admin",               icon: Shield },
  { label: "Warehouse",       value: "WarehousePersonnel",  icon: Package },
  { label: "Procurement",     value: "ProcurementOfficer",  icon: ShoppingCart },
] as const;

const schema = z.object({
  username:     z.string().min(1, "Email / Username is required"),
  password:     z.string().min(1, "Password is required"),
  role:         z.string().min(1, "Please select your role"),
  agreeToTerms: z.boolean().refine((v) => v === true, "You must agree to the Terms and Conditions"),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router  = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading]     = useState(false);
  const [selectedRole, setSelectedRole] = useState("");

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { agreeToTerms: false, role: "" },
  });

  const handleRoleSelect = (value: string) => {
    setSelectedRole(value);
    setValue("role", value, { shouldValidate: true });
  };

  const onSubmit = async (data: FormValues) => {
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>("/auth/login", {
        username: data.username,
        password: data.password,
      });

      if (res.data.user.role !== data.role) {
        toast.error(
          `Wrong role selected. Your account role is "${res.data.user.role}".`
        );
        return;
      }

      setAuth(res.data.user, res.data.token);
      toast.success(`Welcome back, ${res.data.user.firstName}!`);
      router.push("/");
    } catch {
      toast.error("Invalid username or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, #0b1120 0%, #0f2040 100%)" }}
    >
      <div
        className="w-full max-w-5xl rounded-2xl overflow-hidden shadow-2xl flex"
        style={{ minHeight: 620 }}
      >
        {/* ── LEFT PANEL ─────────────────────────────────────────── */}
        <div
          className="hidden lg:flex lg:w-[45%] relative flex-col p-10"
          style={{
            backgroundImage: "url(/background.svg)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {/* dark overlay */}
          <div
            className="absolute inset-0"
            style={{ background: "rgba(8, 20, 55, 0.75)" }}
          />

          <div className="relative z-10 flex flex-col h-full justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-orange-500 flex items-center justify-center shadow-lg flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.svg" alt="ConstructIQ logo" className="w-7 h-7" />
              </div>
              <div>
                <p className="text-white font-bold text-xl leading-tight">ConstructIQ</p>
                <p className="text-blue-300 text-xs">company name</p>
              </div>
            </div>

            {/* Headline + features */}
            <div>
              <h1 className="text-white font-bold text-3xl leading-snug mb-3">
                Intelligent Construction<br />Material Management
              </h1>
              <p className="text-blue-200 text-sm mb-8">
                Predictive analytics, demand forecasting, and waste
                optimization – in one platform.
              </p>

              <div className="space-y-4">
                {[
                  { Icon: TrendingUp,  text: "AI-powered demand forecasting" },
                  { Icon: Box,         text: "Real-time inventory monitoring" },
                  { Icon: ShieldCheck, text: "Role-based secure access" },
                ].map(({ Icon, text }) => (
                  <div key={text} className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{
                        background: "rgba(249,115,22,0.15)",
                        border: "1px solid rgba(249,115,22,0.3)",
                      }}
                    >
                      <Icon className="w-4 h-4 text-orange-400" />
                    </div>
                    <span className="text-blue-100 text-sm">{text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <p className="text-blue-300 text-xs text-center leading-relaxed">
              Developed by Group 11 Capstone ConstructIQ Team
              <br />© 2026 All Rights Reserved
            </p>
          </div>
        </div>

        {/* ── RIGHT PANEL ────────────────────────────────────────── */}
        <div
          className="w-full lg:w-[55%] flex flex-col justify-center p-8 overflow-y-auto"
          style={{ background: "#0d1526" }}
        >
          <div className="max-w-sm mx-auto w-full">
            {/* Header */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-orange-400 mb-1">Welcome back!</h2>
              <p className="text-gray-400 text-sm">Sign in to your workspace</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Email / Username */}
              <div>
                <label className="block text-sm text-gray-300 font-medium mb-1.5">
                  Email address
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                  <input
                    {...register("username")}
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg text-white text-sm outline-none transition-colors"
                    style={{
                      background: "#060e1e",
                      border: "1px solid #1e3a5f",
                    }}
                    placeholder="yourname@constructiq.com"
                    autoComplete="username"
                    onFocus={(e) =>
                      (e.currentTarget.style.borderColor = "#3b82f6")
                    }
                    onBlur={(e) =>
                      (e.currentTarget.style.borderColor = "#1e3a5f")
                    }
                  />
                </div>
                {errors.username && (
                  <p className="mt-1 text-xs text-red-400">{errors.username.message}</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm text-gray-300 font-medium mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                  <input
                    {...register("password")}
                    type="password"
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg text-white text-sm outline-none transition-colors"
                    style={{
                      background: "#060e1e",
                      border: "1px solid #1e3a5f",
                    }}
                    placeholder="••••••••••••••"
                    autoComplete="current-password"
                    onFocus={(e) =>
                      (e.currentTarget.style.borderColor = "#3b82f6")
                    }
                    onBlur={(e) =>
                      (e.currentTarget.style.borderColor = "#1e3a5f")
                    }
                  />
                </div>
                {errors.password && (
                  <p className="mt-1 text-xs text-red-400">{errors.password.message}</p>
                )}
              </div>

              {/* Remember me */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="remember"
                  className="w-3.5 h-3.5 rounded accent-orange-500"
                />
                <label htmlFor="remember" className="text-xs text-gray-400 select-none cursor-pointer">
                  Remember me
                </label>
              </div>

              {/* Role Selection */}
              <div>
                <p className="text-xs font-semibold tracking-widest text-gray-500 mb-2">
                  ROLE DETECTED
                </p>
                <div className="flex flex-wrap gap-2">
                  {ROLES.map(({ label, value, icon: Icon }) => {
                    const active = selectedRole === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleRoleSelect(value)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 cursor-pointer"
                        style={{
                          background: active ? "#ffffff" : "#162035",
                          color:      active ? "#0d1526" : "#64748b",
                          border:     active ? "1px solid #ffffff" : "1px solid #253554",
                        }}
                      >
                        <Icon className="w-3 h-3" />
                        {label}
                      </button>
                    );
                  })}
                </div>
                {errors.role && (
                  <p className="mt-1 text-xs text-red-400">{errors.role.message}</p>
                )}
                <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-500">
                  <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  Your System Overview is automatically configured based on your assigned role.
                </p>
              </div>

              {/* Terms & Conditions */}
              <div>
                <div className="flex items-start gap-2">
                  <input
                    {...register("agreeToTerms")}
                    type="checkbox"
                    id="terms"
                    className="mt-0.5 w-3.5 h-3.5 rounded accent-orange-500 flex-shrink-0 cursor-pointer"
                  />
                  <label htmlFor="terms" className="text-xs text-gray-400 select-none cursor-pointer">
                    I agree to the{" "}
                    <a href="#" className="text-orange-400 hover:underline">
                      Terms and Conditions
                    </a>{" "}
                    and{" "}
                    <a href="#" className="text-orange-400 hover:underline">
                      Privacy Policy
                    </a>
                    .
                  </label>
                </div>
                {errors.agreeToTerms && (
                  <p className="mt-1 text-xs text-red-400">{errors.agreeToTerms.message}</p>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg text-white font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 mt-1"
                style={{ background: "#1a3a6b" }}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Sign in to ConstructIQ"
                )}
              </button>

              {/* Links */}
              <div className="flex items-center justify-between text-xs">
                <a href="#" className="text-orange-400 hover:underline">
                  Forgot password?
                </a>
                <span className="text-gray-500">
                  Need Access?{" "}
                  <a href="#" className="text-orange-400 hover:underline">
                    Contact Admin
                  </a>
                </span>
              </div>

              {/* Secure notice */}
              <div
                className="flex items-start gap-3 p-3 rounded-lg"
                style={{ background: "#111d30", border: "1px solid #1e3a5f" }}
              >
                <Lock className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-gray-300">Secure access</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Self-registration is disabled. Accounts are provisioned by
                    your System Administrator only.
                  </p>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
