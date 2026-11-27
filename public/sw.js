// SuperPad Minimal PWA Service Worker
// Strictly never caches /api/* endpoints to preserve zero-knowledge auth & fresh note sync.
const CACHE_NAME = "superpad-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(["/manifest.json", "/icon.svg", "/icon-192.png", "/icon-512.png"]).catch(() => {})
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept API calls
  if (url.pathname.startsWith("/api/")) return;

  // Network-first for HTML/scripts, falling back to cache only if offline
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
