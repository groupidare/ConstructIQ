import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_ROUTES = ["/", "/login", "/forgot-password", "/reset-password"];

// Behind a reverse proxy (Caddy on the Azure VM), request.url carries the
// internal address Next.js listens on (http://localhost:3000), so a redirect
// built from it sends the browser off the real site. Rebuild the origin from
// the proxy's forwarded headers instead, falling back to the plain Host
// header (and request.url's protocol) when running locally without a proxy.
function redirectTo(request: NextRequest, path: string) {
  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    request.nextUrl.host;
  return NextResponse.redirect(new URL(path, `${proto}://${host}`));
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  const { pathname } = request.nextUrl;

  // Landing page & login are public
  if (PUBLIC_ROUTES.includes(pathname)) {
    // Authenticated users visiting login → go to dashboard
    if (token && pathname === "/login") {
      return redirectTo(request, "/projects");
    }
    return NextResponse.next();
  }

  if (!token) {
    return redirectTo(request, "/");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|icons|manifest.json|favicon.ico|.*\\..*).*)"],
};
