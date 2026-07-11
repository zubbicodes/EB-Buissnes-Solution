/* eslint-disable no-restricted-globals */
import { clientsClaim } from "workbox-core";
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

clientsClaim();
self.skipWaiting();

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("eb-offline-v1").then((cache) => cache.add("/offline.html")),
  );
});

registerRoute(
  ({ request, url }) =>
    request.destination === "image" &&
    url.origin === self.location.origin &&
    !url.pathname.startsWith("/api/"),
  new CacheFirst({
    cacheName: "eb-images-v1",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  }),
);

const appShellHandler = createHandlerBoundToURL("/index.html");

const navigationHandler = async (params) => {
  try {
    return await appShellHandler(params);
  } catch {
    const cache = await caches.open("eb-offline-v1");
    return cache.match("/offline.html");
  }
};

registerRoute(
  new NavigationRoute(navigationHandler, {
    denylist: [/^\/api\//],
  }),
);
