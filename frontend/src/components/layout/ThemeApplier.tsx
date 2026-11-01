"use client";

import { useEffect } from "react";
import { useTheme } from "@/store/themeStore";

export default function ThemeApplier() {
  const theme = useTheme((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return null;
}
