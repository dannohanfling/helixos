import { serviceWorkerSource } from "@/lib/engine/pwa";
import { APP_BUILD } from "@/lib/version";

/**
 * The service worker (H-626, Phase 1) at the site root, so its scope is the whole app. Served signed out (src/proxy.ts), never
 * cached by the browser or the CDN, and named for the build so each deploy refreshes the offline screen.
 */
export function GET() {
  return new Response(serviceWorkerSource(APP_BUILD.sha), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
