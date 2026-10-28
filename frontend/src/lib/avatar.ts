const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api").replace(/\/api\/?$/, "");

// Any uploaded-file URL from the backend (avatars, delivery proof photos, etc.)
// is a relative path like "/uploads/avatars/8_ab12.jpg" — it needs to resolve
// against the API server's origin, not the frontend's.
// Files stored in Cloudflare R2 are saved with their public *.r2.dev URL,
// which some ISPs block — load them through the API's own /uploads route
// instead (backend UploadsController), so they work on every network.
const R2_PUBLIC_URL = /^https?:\/\/pub-[0-9a-z]+\.r2\.dev\/(.+)$/i;

export function resolveUploadUrl(url?: string | null): string | null {
  if (!url) return null;
  const r2 = R2_PUBLIC_URL.exec(url);
  if (r2) return `${API_ORIGIN}/uploads/${r2[1]}`;
  // Already absolute, or a local (unsaved) preview — pass through unchanged.
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

export function resolveAvatarUrl(avatarUrl?: string | null): string | null {
  return resolveUploadUrl(avatarUrl);
}
