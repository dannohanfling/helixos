/**
 * The home-screen app (H-626, Phase 1): the pure parts, kept here so they can be tested without a browser.
 *
 * The service worker only ever answers a failed page load with the offline screen. It never stores a signed-in page or an
 * API answer, so no member's data (HumanOS above all) is ever kept on the phone's disk by it.
 */

/** The one page the worker keeps: served by src/app/offline/route.ts, with everything it needs inline. */
export const OFFLINE_PATH = "/offline";

/** The worker's cache, named for the build, so a new deploy replaces the offline screen and drops the old one. */
export function cacheName(build: string): string {
  return `helixos-offline-${build.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40) || "dev"}`;
}

/** The service worker itself, as served at /sw.js. Plain JavaScript, no imports: it runs outside the app. */
export function serviceWorkerSource(build: string): string {
  const cache = JSON.stringify(cacheName(build));
  const offline = JSON.stringify(OFFLINE_PATH);
  return `// HelixOS service worker (H-626). Network first for page loads; the offline screen only when the network fails.
// It never caches signed-in pages or API answers.
const CACHE = ${cache};
const OFFLINE = ${offline};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE, { cache: "reload", credentials: "omit" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith("helixos-") && n !== CACHE).map((n) => caches.delete(n)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate" || req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
      return await fetch(req);
    } catch (err) {
      const cached = await caches.match(OFFLINE, { cacheName: CACHE });
      if (cached) return cached;
      throw err;
    }
  })());
});
`;
}

/** What the install card should offer on this browser, from its user agent and whether it already runs installed. */
export type InstallKind = "ios" | "android" | null;

export function installKind(ua: string, opts: { standalone: boolean; native: boolean }): InstallKind {
  if (opts.standalone || opts.native) return null;
  if (/iPhone|iPod/.test(ua)) return "ios";
  // iPadOS reports itself as a Mac; the card is for phones (the 390px design), so an iPad is left alone.
  if (/Android/.test(ua) && /Mobile/.test(ua)) return "android";
  return null;
}

/** How many separate days the card must have been eligible before it shows: "after their third day" (H-626). */
export const INSTALL_AFTER_DAYS = 3;

/**
 * The days this browser has seen Today while the card was eligible, with `today` added, at most the last few. Kept on the
 * device (localStorage), never in the database: the card is about this phone, not the member.
 */
export function seenDays(stored: string | null, today: string): string[] {
  let days: string[] = [];
  try {
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (Array.isArray(parsed)) days = parsed.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));
  } catch {
    days = [];
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(today) && !days.includes(today)) days.push(today);
  return days.sort().slice(-INSTALL_AFTER_DAYS);
}

export function readyToOffer(days: string[]): boolean {
  return days.length >= INSTALL_AFTER_DAYS;
}
