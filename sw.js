/**
 * Service worker for the installable (PWA) build.
 *
 * Its job is to make the app work with no network at all, and to pick up a new
 * build or a new evidence snapshot the next time the app is opened — without a
 * store and without the user doing anything.
 *
 * Caching strategy, by resource class:
 *
 *   app shell (html/js/css/icons)  stale-while-revalidate, versioned by BUILD
 *   evidence data                   cache-first, versioned by DATA version
 *   update manifest                 always network-first, never cached
 *
 * The data is immutable for a given version, so it is served
 * from cache and only re-fetched when the app activates a newer snapshot. It is
 * precached at install, because a service worker cannot cache anything the page
 * fetched before it took control — see BUNDLED_DATA.
 */

const BUILD = "1.0.0-glass-58bed1277d-05f277ba77";
const DATA = "9c567745135f";

const SHELL_CACHE = `imei-shell-${BUILD}`;
const DATA_CACHE = `imei-data-${DATA}`;

/*
 * Which data cache to serve from. Starts as the snapshot bundled with this
 * build, and is switched at runtime when the page downloads and activates a
 * newer one. Mutable because the two are genuinely independent: the shell can
 * be years behind the evidence.
 */
let activeDataCache = DATA_CACHE;

/** Paths that make up the app shell. Hashed asset names are added at runtime. */
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/assets/amaya-glass-58bed1277d.css",
  "/assets/amaya-glass-05f277ba77.js",
  // Vendored fonts. These have stable, unhashed filenames, so listing them is
  // safe: a font change is picked up because it changes BUILD, which names a new
  // shell cache. Without them here the app renders in system fonts offline,
  // which reads as a different app than the one installed.
  "/fonts/fonts.css",
  "/fonts/space-grotesk-400-latin.woff2",
  "/fonts/space-grotesk-500-latin.woff2",
  "/fonts/space-grotesk-600-latin.woff2",
  "/fonts/space-grotesk-700-latin.woff2",
  "/fonts/space-grotesk-400-latin-ext.woff2",
  "/fonts/space-grotesk-500-latin-ext.woff2",
  "/fonts/space-grotesk-600-latin-ext.woff2",
  "/fonts/space-grotesk-700-latin-ext.woff2",
  "/fonts/dm-mono-400-latin.woff2",
  "/fonts/dm-mono-500-latin.woff2",
  "/fonts/dm-mono-400-latin-ext.woff2",
  "/fonts/dm-mono-500-latin-ext.woff2",
];

/**
 * The evidence snapshot bundled with this build, precached into the data cache.
 *
 * These are not in SHELL because they belong to the data cache, which is
 * versioned independently. They are precached rather than left to be cached
 * opportunistically because a service worker only intercepts requests made
 * *after* it takes control: on a first visit the page has already fetched the
 * ledger by the time the worker activates, so nothing gets cached and the app
 * cannot start without a network. That was not theoretical — with the self-hosted
 * server stopped, the shell rendered from cache while /data/meta.json failed and
 * the app showed an error instead of the ledger.
 *
 * It costs the bundled snapshot's size (~0.5 MB on this build) of install
 * time and storage, which is the correct trade for a
 * tool whose whole point is running with no network.
 */
const BUNDLED_DATA = ["/data/meta.json", "/data/assets.json", "/data/events.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 cannot fail the whole install.
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => undefined),
        ),
      );

      const data = await caches.open(DATA_CACHE);
      const results = await Promise.all(
        BUNDLED_DATA.map(async (url) => {
          try {
            await data.add(new Request(url, { cache: "reload" }));
            return true;
          } catch (err) {
            // Surfaced rather than swallowed: this is the difference between an
            // app that works offline and one that does not, and it is invisible
            // until the network is gone.
            console.warn("[sw] could not precache evidence snapshot", url, err);
            return false;
          }
        }),
      );
      if (results.some((ok) => !ok)) {
        throw new Error("evidence snapshot could not be precached; offline use will fail");
      }

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("imei-shell-") || k.startsWith("imei-data-"))
          .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          // Old data snapshots are large; drop them eagerly.
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Ask open tabs whether new data is ready, so they can reload into it. */
async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "SKIP_WAITING") self.skipWaiting();

  if (msg.type === "ACTIVATE_DATA" && typeof msg.dataVersion === "string") {
    // The renderer has already written the new snapshot into its own cache.
    // Point every later request at it, then drop the superseded one.
    event.waitUntil(
      (async () => {
        activeDataCache = `imei-data-${msg.dataVersion}`;
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith("imei-data-") && k !== activeDataCache)
            // Old snapshots are megabytes; drop them eagerly.
            .map((k) => caches.delete(k)),
        );
        await notifyClients({ type: "DATA_ACTIVATED", dataVersion: msg.dataVersion });
      })(),
    );
  }
});

function isDataRequest(url) {
  return url.pathname.startsWith("/data/");
}

function isManifestRequest(url) {
  return url.pathname.startsWith("/update/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the update manifest: a stale manifest means a missed update.
  if (isManifestRequest(url)) return;

  if (isDataRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(activeDataCache);
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        const res = await fetch(req);
        // The write is deliberately not awaited, so a multi-megabyte snapshot does
        // not delay the response. But a rejection must not be swallowed: an
        // uncached /data file means the app cannot start offline, and silently
        // failing here produces that weeks later with no error to trace.
        if (res.ok) {
          cache.put(req, res.clone()).catch((err) => {
            console.warn("[sw] could not cache evidence snapshot", req.url, err);
          });
        }
        return res;
      })(),
    );
    return;
  }

  // Navigations: network-first, falling back to the cached shell.
  //
  // The fallback has to trigger on an *error status*, not only on a thrown
  // error. A failed `fetch` is not the only way to fail: a captive portal, a
  // corporate proxy, a CDN edge error or a 503 during a deploy all answer with a
  // real 5xx response. Returning that unconditionally replaced the whole app with
  // a gateway error page, which defeats the point of precaching the shell.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put("/index.html", fresh.clone()).catch(() => undefined);
            return fresh;
          }
          // Non-OK: fall through to the cache, remembering the status in case
          // even the cache is unusable.
          const cache = await caches.open(SHELL_CACHE);
          const cached =
            (await cache.match("/index.html")) || (await cache.match("/"));
          if (cached) return cached;
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match("/index.html")) ||
            (await cache.match("/")) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // Everything else in the shell: serve fast, refresh in the background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            cache.put(req, res.clone()).catch((err) => {
              console.warn("[sw] could not refresh shell entry", req.url, err);
            });
          }
          return res;
        })
        .catch(() => undefined);
      return hit || (await network) || new Response("", { status: 504, statusText: "offline" });
    })(),
  );
});
