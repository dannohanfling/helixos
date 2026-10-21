"use client";

import { useEffect, useState } from "react";
import { installKind, readyToOffer, seenDays, type InstallKind } from "@/lib/engine/pwa";

const DAYS_KEY = "helix.install.days";
const DISMISSED_KEY = "helix.install.dismissed";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing: the card simply comes back next time.
  }
}

/**
 * "Add HelixOS to your home screen" (H-626, Phase 1). Today mounts it for a client only. It shows on a phone's browser, never
 * inside the installed app or the store app, from the third separate day this phone opens Today, until it is dismissed.
 * Everything it remembers stays on this phone.
 */
export function InstallCard({ today }: { today: string }) {
  const [kind, setKind] = useState<InstallKind>(null);
  const [canPrompt, setCanPrompt] = useState(false);

  useEffect(() => {
    if (read(DISMISSED_KEY)) return;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const native = "Capacitor" in window;
    const k = installKind(navigator.userAgent, { standalone, native });
    if (!k) return;
    const days = seenDays(read(DAYS_KEY), today);
    write(DAYS_KEY, JSON.stringify(days));
    if (!readyToOffer(days)) return;
    // Reading the browser and this phone's own record, after the page has drawn: there is no server value to match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKind(k);
    const sync = () => setCanPrompt(Boolean(window.__helixInstallPrompt));
    sync();
    window.addEventListener("helix:installprompt", sync);
    return () => window.removeEventListener("helix:installprompt", sync);
  }, [today]);

  if (!kind) return null;

  const dismiss = () => {
    write(DISMISSED_KEY, today);
    setKind(null);
  };

  const install = async () => {
    const ev = window.__helixInstallPrompt;
    if (!ev) return;
    await ev.prompt();
    const choice = await ev.userChoice.catch(() => null);
    window.__helixInstallPrompt = null;
    setCanPrompt(false);
    if (choice?.outcome === "accepted") dismiss();
  };

  return (
    <section className="card mb-5 p-4 sm:p-5" aria-labelledby="install-title" data-testid="install-card">
      <div className="flex items-start gap-3">
        {/* The app icon itself (H-667), so members know what to look for on their home screen. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/app-icon/icon-192.png" width={44} height={44} alt="" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <h2 id="install-title" className="font-semibold">
            Add HelixOS to your home screen
          </h2>
          <p className="mt-0.5 text-sm text-ink-2">It opens straight to Today, full screen, like any other app.</p>
        </div>
      </div>
      {kind === "ios" ? (
        <ol className="mt-3 grid gap-2 text-sm" data-testid="install-steps-ios">
          <li className="flex items-center gap-2">
            <Step n={1} />
            <span>
              Tap <b>Share</b> <ShareGlyph /> at the bottom of Safari
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Step n={2} />
            <span>
              Choose <b>Add to Home Screen</b>
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Step n={3} />
            <span>
              Tap <b>Add</b>
            </span>
          </li>
        </ol>
      ) : (
        <p className="mt-3 text-sm text-ink-2" data-testid="install-steps-android">
          {canPrompt ? "One tap and it's on your home screen." : (
            <>
              In Chrome, open the menu <b>⋮</b> and choose <b>Add to Home screen</b> or <b>Install app</b>.
            </>
          )}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {kind === "android" && canPrompt ? (
          <button type="button" className="btn btn-primary min-h-11" onClick={install} data-testid="install-now">
            Install HelixOS
          </button>
        ) : null}
        <button type="button" className="btn min-h-11" onClick={dismiss} data-testid="install-dismiss">
          {kind === "ios" ? "Done" : "Not now"}
        </button>
      </div>
    </section>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink" aria-hidden="true">
      {n}
    </span>
  );
}

/** The iOS share icon, drawn, so members recognise the button they're looking for. */
function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className="inline-block align-[-2px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share icon">
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}
