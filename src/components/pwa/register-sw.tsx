"use client";

import { useEffect } from "react";

/** Chrome's install prompt, which it offers once per page load; kept so the install card can use it later (H-626). */
export type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

declare global {
  interface Window {
    __helixInstallPrompt?: InstallPromptEvent | null;
  }
}

/**
 * Registers the service worker (/sw.js, H-626 Phase 1) once per page load, and keeps Chrome's install prompt for the
 * install card. Mounted once in the root layout; renders nothing. Development is left alone, so a dev server never has a
 * worker in front of it.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    const keep = (e: Event) => {
      e.preventDefault();
      window.__helixInstallPrompt = e as InstallPromptEvent;
      window.dispatchEvent(new Event("helix:installprompt"));
    };
    const installed = () => {
      window.__helixInstallPrompt = null;
    };
    window.addEventListener("beforeinstallprompt", keep);
    window.addEventListener("appinstalled", installed);
    // Inside the store app (H-1966) the app keeps its own offline screen (mobile/www/offline.html, dark, H-1813). A worker here
    // would answer a dropped connection with this site's light /offline page first, so the app gets none, and any worker an
    // earlier version left behind is removed.
    const inApp = Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    if (inApp && "serviceWorker" in navigator) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((rs) => Promise.all(rs.map((r) => r.unregister())))
        .catch(() => undefined);
    } else if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
        // No worker means no offline screen; the app itself works the same.
      });
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", keep);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  return null;
}
