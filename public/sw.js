/* Hinova Marketplace service worker: makes the site installable, opens fast, and keeps listing photos cached. */
const VERSION = "hinova-v9";
const SHELL = ["/", "/styles.css", "/app.js", "/us.js", "/ev.js", "/policies.js", "/manifest.webmanifest", "/icons/icon-192.png"];
const PHOTOS = "hinova-photos";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== PHOTOS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trimPhotos() {
  const c = await caches.open(PHOTOS), keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - 300))) await c.delete(k);
}
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // listing photos never change: cache first
  if (url.pathname.startsWith("/api/photos/")) {
    e.respondWith(caches.open(PHOTOS).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { c.put(req, res.clone()); trimPhotos(); }
      return res;
    }));
    return;
  }
  if (url.pathname.startsWith("/api/")) return; // live data always comes from the network
  // pages and app files: network first so updates show right away, cache when offline
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && (req.mode === "navigate" || SHELL.includes(url.pathname))) caches.open(VERSION).then((c) => c.put(req.mode === "navigate" ? "/" : req, res.clone()));
    return res;
  }).catch(() => caches.match(req.mode === "navigate" ? "/" : req).then((r) => r || caches.match("/"))));
});
