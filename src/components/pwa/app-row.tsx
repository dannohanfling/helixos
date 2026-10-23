"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Settings → Account's line about the HelixOS app (H-655, H-731). With the app: which phone, and its notifications. Before a
 * store link is set: Coming soon. Otherwise the way to Get the app, or, opened from the home-screen icon, what the store app adds.
 */
export function AppRow({ hasApp, linksOn }: { hasApp: "ios" | "android" | null; linksOn: boolean }) {
  const [home, setHome] = useState(false);
  useEffect(() => {
    // How the page was opened is known only in the browser, after the page has drawn.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHome(document.documentElement.dataset.installed === "home" || window.matchMedia("(display-mode: standalone)").matches);
  }, []);
  return (
    <li data-testid="account-app">
      <span className="font-medium">The HelixOS app: </span>
      {hasApp ? (
        <>
          <span data-testid="account-app-have">you have it on {hasApp === "ios" ? "iPhone" : "Android"}.</span>{" "}
          <Link href="/settings/notifications" className="btn btn-ghost btn-sm ml-1 min-h-11" data-testid="account-app-notifications">
            Notifications
          </Link>
        </>
      ) : !linksOn ? (
        <span className="badge text-[10px]" data-testid="account-app-soon">
          Coming soon
        </span>
      ) : home ? (
        <span data-testid="account-app-home">
          you&apos;re using HelixOS from your home screen. The store app adds reminders.{" "}
          <Link href="/get-the-app" className="btn btn-ghost btn-sm ml-1 min-h-11" data-testid="account-app-get-home">
            Get the app
          </Link>
        </span>
      ) : (
        <Link href="/get-the-app" className="btn btn-ghost btn-sm min-h-11" data-testid="account-app-get">
          Get the app →
        </Link>
      )}
    </li>
  );
}
