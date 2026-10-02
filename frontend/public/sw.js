const CACHE_NAME = "constructiq-cache-v1";
const APP_SHELL = ["/", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never cache API calls — data must always come from the network so the
  // dashboard never silently shows stale project/inventory state as current.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first, so a returning user always gets the latest
  // deployed build; only fall back to the cached shell when fully offline.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  // Next.js client-side page transitions (clicking a <Link>) fetch an RSC
  // payload as e.g. "/admin/settings?_rsc=xyz" — not a "navigate" request,
  // so it used to fall into the cache-first branch below. That payload is
  // dynamic, auth-dependent page content (can legitimately be a redirect to
  // "/" if whoever triggered the very first prefetch wasn't logged in yet),
  // not a static asset — caching it forever meant a stale first-ever response
  // (e.g. an unauthenticated redirect) got replayed on every later click,
  // regardless of actual login state. Always go to the network for these.
  if (url.searchParams.has("_rsc")) {
    event.respondWith(fetch(request));
    return;
  }

  // Static assets (hashed build chunks, icons, fonts): cache-first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
