const CACHE_NAME = "itc-gestion-materiels-v74-tech-material-labels";
const APP_SHELL = [
  "./assets/request-routing.js",
  "./assets/bon-signatures.js",
  "./assets/bon-scanner.js?v=20261008-manager-debit",
  "./assets/storekeeper-backlog.js?v=20261008-office-auto-bons",
  "./assets/manager-locations.js",
  "./assets/manager-flux.js",
  "./assets/stock-substocks.js",
  "./assets/manager-b01-substocks.js?v=20261004-custom-substocks",
  "./assets/stock-substocks.css?v=20260924",
  "./assets/manager-flux.css?v=20260924",
  "./",
  "./index.html",
  "./assets/profile.js",
  "./assets/notification-tabs.js?v=20261004-notification-badges",
  "./assets/manager-stock.js?v=20260923-tabs",
  "./assets/account-affiliation.js",
  "./assets/company-users.js?v=20260926-affiliations",
  "./assets/control-core.js",
  "./assets/control-core.js?v=20260923-regional",
  "./assets/stock-control-store.js?v=20261006-supabase",
  "./assets/stock-control.js?v=20261006-supabase",
  "./assets/cable-offcuts.js",
  "./assets/cable-offcuts-transport.js",
  "./assets/supabase-config.js",
  "./assets/supabase-public-config.js",
  "./assets/supabase-public-config.js?v=20260918-shared1",
  "./assets/supabase-config.js?v=20260918-shared1",
  "./assets/cable-offcuts-transport.js?v=20260918-shared1",
  "./assets/supabase-store.js",
  "./assets/supabase-store.js?v=20260923-receipts",
  "./assets/validator-workflow.js?v=20261008-manager-debit",
  "./assets/validator-workflow.js",
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
  if (event.data && event.data.type === "SYNC_APP_BADGE") {
    const count = Number(event.data.count);
    const badgeUpdate = Number.isFinite(count) && count > 0
      ? self.registration.setAppBadge?.(count)
      : self.registration.clearAppBadge?.();
    event.waitUntil(Promise.resolve(badgeUpdate).catch(() => {}));
  }
});

self.addEventListener("push", event => {
  let data={};
  try { data=event.data?.json() || {}; } catch (_) { data={body:event.data?.text() || "Nouvelle notification."}; }
  const badgePromise=Number.isFinite(Number(data.unreadCount)) && Number(data.unreadCount)>0 ? self.registration.setAppBadge?.(Number(data.unreadCount)) : Promise.resolve();
  event.waitUntil(Promise.all([badgePromise,self.registration.showNotification(data.title || "ITC Gestion MatÃ©riels", {body:data.body || "Nouvelle notification.",icon:"./assets/pwa-icon-192.png",badge:"./assets/pwa-icon-192.png",tag:data.notificationId || "itc-notification",renotify:true,silent:false,data:{url:data.url || "./index.html"}})]));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data?.url || "./index.html";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(windows => { const target=new URL(url,self.location.href); const existing=windows.find(window=>new URL(window.url).origin===target.origin); return existing ? existing.focus() : clients.openWindow(target.href); }));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never persist authenticated API responses.
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

  // Prefer the current application code; cached modules remain an offline fallback.
  if (url.pathname.endsWith('.js')) {
    event.respondWith(fetch(request, {cache:'no-cache'})
      .then(response => {if (!response.ok) throw new Error('Module unavailable'); return updateCache(request, response);})
      .catch(async () => (await caches.match(request)) || Response.error()));
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

