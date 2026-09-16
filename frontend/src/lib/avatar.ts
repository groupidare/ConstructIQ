const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api").replace(/\/api\/?$/, "");

// AvatarUrl from the backend is a relative path like "/uploads/avatars/8_ab12.jpg" —
// it needs to resolve against the API server's origin, not the frontend's.
export function resolveAvatarUrl(avatarUrl?: string | null): string | null {
  if (!avatarUrl) return null;
  // Already absolute, or a local (unsaved) preview — pass through unchanged.
  if (/^(https?:|blob:|data:)/i.test(avatarUrl)) return avatarUrl;
  return `${API_ORIGIN}${avatarUrl}`;
}
