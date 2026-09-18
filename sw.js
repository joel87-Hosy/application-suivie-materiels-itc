const CACHE_NAME = "itc-gestion-materiels-v19-supabase-offcuts";
const APP_SHELL = [
  "./",
  "./index.html",
  "./assets/profile.js",
  "./assets/secure-store.js",
  "./assets/control-core.js",
  "./assets/stock-control.js",
  "./assets/cable-offcuts.js",
  "./assets/cable-offcuts-transport.js",
  "./assets/supabase-config.js",
  "./assets/supabase-store.js",
  "./assets/assistant-knowledge.js",
  "./assets/assistant-reports.js",
  "./assets/voice-assistant.js",
  "./assets/bon-reference.js",
  "./assets/push-config.js",
  "./assets/push-notifications.js",
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

importScripts("https://www.gstatic.com/firebasejs/9.17.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.17.1/firebase-messaging-compat.js");
importScripts("./assets/push-config.js");
firebase.initializeApp({apiKey:"AIzaSyD7P-6vY3yHQx7OFCs6th6gN6EURP89QUQ",authDomain:"itc-erp.firebaseapp.com",projectId:"itc-erp",messagingSenderId:"870100539481",appId:"1:870100539481:web:e12d817a9a44e867e97948"});
firebase.messaging().onBackgroundMessage(payload => {
  const data = payload.data || {};
  return self.registration.showNotification(data.title || "ITC Gestion Matériels", {body:data.body || "Nouvelle notification.",icon:"./assets/pwa-icon-192.png",badge:"./assets/pwa-icon-192.png",tag:data.notificationId || "itc-notification",renotify:true,silent:false,data:{url:data.url || "./index.html"}});
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data?.url || "./index.html";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(windows => windows[0] ? windows[0].focus() : clients.openWindow(url)));
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
