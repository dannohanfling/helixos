"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Settings → Notifications, inside the HelixOS app only (H-1612): whether this phone lets HelixOS send notifications, and an
 * Allow that opens the phone's own prompt. The automatic ask stays the card after the first evening close (H-767); this is
 * the member's own tap, any time. On the website it renders nothing.
 */
type PushPlugin = {
  checkPermissions: () => Promise<{ receive: string }>;
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
};
type Cap = { isNativePlatform: () => boolean; getPlatform: () => string; Plugins: { PushNotifications?: PushPlugin } };
type State = "on" | "off" | "blocked";

const native = (): { cap: Cap; push: PushPlugin } | null => {
  const c = (window as unknown as { Capacitor?: Cap }).Capacitor;
  const push = c?.Plugins?.PushNotifications;
  return c?.isNativePlatform?.() && push ? { cap: c, push } : null;
};

/** The phone's answer, in three words: granted is on, denied is blocked (only the phone's settings undo it), else off. */
export function permissionState(receive: string): State {
  return receive === "granted" ? "on" : receive === "denied" ? "blocked" : "off";
}

export function PhonePushSwitch() {
  const router = useRouter();
  const [phone, setPhone] = useState<{ state: State; platform: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const n = native();
    if (!n) return;
    const platform = n.cap.getPlatform();
    void n.push
      .checkPermissions()
      .catch(() => ({ receive: "prompt" }))
      .then((p) => setPhone({ state: permissionState(p.receive), platform }));
  }, []);

  if (!phone) return null;
  const { state, platform } = phone;

  const allow = async () => {
    const n = native();
    if (!n) return;
    setBusy(true);
    // Saying yes here counts as yes to the HelixOS card too, so it never asks again.
    await fetch("/api/app/push-ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer: "yes" }) }).catch(() => undefined);
    const p = await n.push.requestPermissions().catch(() => ({ receive: "denied" }));
    const next = permissionState(p.receive);
    // The app's registration listener (native-bridge.tsx) sends the new token to HelixOS; refresh so "Your phones" shows it.
    if (next === "on") await n.push.register().catch(() => undefined);
    setPhone({ state: next, platform });
    setBusy(false);
    window.setTimeout(() => router.refresh(), 1500);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm" data-testid="phone-push" data-state={state}>
      <span>
        <span className="font-medium">Notifications on this phone: </span>
        {state === "on" ? "On" : "Off"}
      </span>
      {state === "off" ? (
        <button type="button" className="btn btn-primary min-h-11" disabled={busy} onClick={() => void allow()} data-testid="phone-push-allow">
          Allow
        </button>
      ) : null}
      {state === "blocked" ? (
        <div className="basis-full space-y-2" data-testid="phone-push-blocked">
          <p className="text-ink-2">This phone said no before. Turn them on in your phone&apos;s Settings → HelixOS → Notifications.</p>
          {/* An important step is a button, never a small link (H-1794). */}
          {platform === "ios" ? (
            <a href="app-settings:" className="btn btn-primary min-h-11 w-full justify-center" data-testid="phone-push-open-settings">
              Open Settings
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
