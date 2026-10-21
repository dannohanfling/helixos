"use client";

import { useEffect, useState } from "react";

/**
 * The web app's side of the HelixOS apps (H-877). Mounted once in the root layout; on the website it does nothing.
 * Inside the store app (Capacitor) it records this phone on every open (Get the app hides once one was opened, H-655), sends
 * the push token once the member has said yes, opens the page a tapped notification points at, and shows the HelixOS card
 * that asks first (H-767): after the first evening close, never on first open. The phone's own prompt only follows a Yes.
 */
type Listener = { remove: () => void };
type PushPlugin = {
  checkPermissions: () => Promise<{ receive: string }>;
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  addListener: (event: string, cb: (e: { value?: string; notification?: { data?: { path?: string } } }) => void) => Promise<Listener>;
};
type Cap = { isNativePlatform: () => boolean; getPlatform: () => string; Plugins: { PushNotifications?: PushPlugin } };

const cap = (): Cap | null => {
  const c = (window as unknown as { Capacitor?: Cap }).Capacitor;
  return c?.isNativePlatform?.() ? c : null;
};

const INSTALL_KEY = "helix.install.id";
function installId(): string {
  try {
    const have = window.localStorage.getItem(INSTALL_KEY);
    if (have) return have;
    const id = crypto.randomUUID();
    window.localStorage.setItem(INSTALL_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

async function record(c: Cap, token?: string) {
  await fetch("/api/app/device", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installId: installId(), platform: c.getPlatform(), token }),
  }).catch(() => undefined);
}

export function NativeBridge() {
  const [ask, setAsk] = useState<{ hour: number } | null>(null);

  useEffect(() => {
    const c = cap();
    // Get the app (H-655) hides on a phone already running HelixOS as an app: the store app, or the home-screen icon. The menu
    // items carry data-app-off, and globals.css hides them under this mark.
    const home = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (c || home) document.documentElement.dataset.installed = c ? "native" : "home";
    if (!c) return;
    const push = c.Plugins.PushNotifications;
    const listeners: Promise<Listener>[] = [];
    void record(c);
    if (push) {
      listeners.push(push.addListener("registration", (e) => void record(c, e.value)));
      listeners.push(
        push.addListener("pushNotificationActionPerformed", (e) => {
          const path = e.notification?.data?.path;
          if (typeof path === "string" && path.startsWith("/")) window.location.assign(path);
        }),
      );
      // Already said yes on this phone: register again on each open, so a changed token reaches HelixOS.
      void push.checkPermissions().then((p) => (p.receive === "granted" ? push.register() : undefined)).catch(() => undefined);
    }
    void fetch("/api/app/push-ask")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ask?: boolean; hour?: number } | null) => {
        if (j?.ask) setAsk({ hour: typeof j.hour === "number" ? j.hour : 8 });
      })
      .catch(() => undefined);
    return () => {
      for (const l of listeners) void l.then((x) => x.remove());
    };
  }, []);

  if (!ask) return null;
  return <PushAskCard hour={ask.hour} onDone={() => setAsk(null)} />;
}

function hourLabel(h: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${ampm}`;
}

function PushAskCard({ hour: initial, onDone }: { hour: number; onDone: () => void }) {
  const [hour, setHour] = useState(initial);
  const [busy, setBusy] = useState(false);

  const answer = async (a: "yes" | "not_now") => {
    setBusy(true);
    await fetch("/api/app/push-ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer: a, hour }) }).catch(() => undefined);
    const c = cap();
    const push = c?.Plugins.PushNotifications;
    if (a === "yes" && c && push) {
      const p = await push.requestPermissions().catch(() => ({ receive: "denied" }));
      if (p.receive === "granted") await push.register().catch(() => undefined);
    }
    onDone();
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6" role="dialog" aria-labelledby="push-ask-title" data-testid="push-ask">
      <div className="card mx-auto max-w-md p-4 shadow-lg">
        <h2 id="push-ask-title" className="font-semibold">
          Want a nudge tomorrow at{" "}
          <select className="field inline-block w-auto py-1" value={hour} onChange={(e) => setHour(Number(e.target.value))} aria-label="Reminder time" data-testid="push-ask-hour">
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>{" "}
          to lock in your three moves?
        </h2>
        <p className="mt-1 text-sm text-ink-2">A few calm reminders a day at most, and every kind can be switched off in Settings.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary min-h-11" disabled={busy} onClick={() => void answer("yes")} data-testid="push-ask-yes">
            Turn on reminders
          </button>
          <button type="button" className="btn min-h-11" disabled={busy} onClick={() => void answer("not_now")} data-testid="push-ask-not-now">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
