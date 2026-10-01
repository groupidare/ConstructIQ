const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api").replace(/\/api\/?$/, "");

// Any uploaded-file URL from the backend (avatars, delivery proof photos, etc.)
// is a relative path like "/uploads/avatars/8_ab12.jpg" — it needs to resolve
// against the API server's origin, not the frontend's.
export function resolveUploadUrl(url?: string | null): string | null {
  if (!url) return null;
  // Already absolute, or a local (unsaved) preview — pass through unchanged.
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

export function resolveAvatarUrl(avatarUrl?: string | null): string | null {
  return resolveUploadUrl(avatarUrl);
}
