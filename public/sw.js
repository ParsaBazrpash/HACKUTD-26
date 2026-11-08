/*
 * HAVEN service worker.
 * Browsers that install the app expect a worker on this origin.
 * This worker stores nothing. Incident pages, messages, keys, invites,
 * and API responses are never written here. Each request stays with the
 * browser, so authenticated calls are neither stored nor rewritten.
 * WebSocket connections are not fetch events and are not seen by this file.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", () => {
  // Leave the request to the browser. Answering it here could store or change it.
});
