const CACHE_NAME = "itc-gestion-materiels-v8-control-all-stocks";
const APP_SHELL = [
  "./",
  "./index.html",
  "./assets/profile.js",
  "./assets/secure-store.js",
  "./assets/control-core.js",
  "./assets/stock-control.js",
  "./assets/stock-control.css",
  "./offline.html",
  "./privacy.html",
  "./manifest.webmanifest",
  "./assets/nouveau-logo-itc.png",
  "./assets/saas-logo.svg",
  "./assets/pwa-icon-192.png",
  "./assets/pwa-icon-512.png",
  "./assets/pwa-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never persist authenticated API responses, including Firebase REST reads.
  if (url.origin !== self.location.origin &&
      !['www.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return;

  const updateCache = (cacheKey, response) => {
    if (response && response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone));
    }
    return response;
  };

  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => updateCache(request, response))
          .catch(() => cached);

        return cached || networkFetch;
      })
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => updateCache("./index.html", response))
        .catch(() =>
          caches
            .match("./index.html")
            .then((cached) => cached || caches.match("./offline.html")),
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached || caches.match("./index.html"));

      return cached || networkFetch;
    })
  );
});
