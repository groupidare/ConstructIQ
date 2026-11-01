"use client";

import { resolveAvatarUrl } from "@/lib/avatar";

export function Avatar({ avatarUrl, initials, size = 36, color = "#f97316", fontSize }: {
  avatarUrl?: string | null;
  initials: string;
  size?: number;
  color?: string;
  fontSize?: string;
}) {
  const src = resolveAvatarUrl(avatarUrl);

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={initials || "Avatar"}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: color,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 700, fontSize: fontSize ?? `${Math.max(11, size * 0.36)}px`,
      flexShrink: 0, userSelect: "none",
    }}>
      {initials || "?"}
    </div>
  );
}
