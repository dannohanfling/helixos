"use client";

import { useEffect, useState } from "react";
import { TESTFLIGHT_APP_URL, type AppDevice, type AppLinks } from "@/lib/app-links";

/** How this page is open: in the store app, from the home-screen icon, or in a browser. Known only after the page has drawn. */
type Running = "native" | "home" | "browser";

function runningNow(): Running {
  if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) return "native";
  if (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true) return "home";
  return "browser";
}

/**
 * The steps on Get the app (H-655): only the ones for this phone, both on a computer or iPad. Test phase: TestFlight then the
 * public link on iPhone, the Play testing link on Android. At release: one store button each. No prices, no upgrade wording.
 */
export function GetAppSteps({ links, device, hasApp }: { links: AppLinks; device: AppDevice; hasApp: "ios" | "android" | null }) {
  const [running, setRunning] = useState<Running>("browser");
  useEffect(() => {
    // Reading the browser itself, after the page has drawn: the server can't know how the page was opened.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunning(runningNow());
  }, []);

  if (running === "native") {
    return (
      <p className="text-sm" data-testid="get-app-have">
        You have the app. You&apos;re using it now.
      </p>
    );
  }

  const ios = links.ios ? <IosSteps url={links.ios} stage={links.stage} /> : null;
  const android = links.android ? <AndroidSteps url={links.android} stage={links.stage} /> : null;
  if (!ios && !android) {
    return (
      <div className="space-y-3 text-sm" data-testid="get-app-soon">
        <p>
          The HelixOS app for iPhone and Android is on its way. This page will have the steps for your phone as soon as it&apos;s
          ready.
        </p>
        {running === "home" ? null : <HomeScreen device={device} />}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {hasApp ? (
        <p className="rounded-lg bg-surface-2 p-3 text-sm" data-testid="get-app-have">
          You have the app on {hasApp === "ios" ? "iPhone" : "Android"}. These steps are here for another phone.
        </p>
      ) : null}
      {device === "other" ? (
        <p className="text-sm text-ink-2" data-testid="get-app-other">
          Open <b>helixos.evolveomega.com/get-the-app</b> on your phone, or follow the steps for it below.
        </p>
      ) : null}
      {device !== "android" && ios ? <Section title="iPhone">{ios}</Section> : null}
      {device !== "ios" && android ? <Section title="Android">{android}</Section> : null}
      {(device === "ios" && !ios) || (device === "android" && !android) ? (
        <p className="text-sm" data-testid="get-app-not-yet">
          The app for your phone isn&apos;t ready yet. It will be soon.
        </p>
      ) : null}
      {running === "home" || device === "other" ? null : (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 text-ink-2">Or add HelixOS to your home screen</summary>
          <HomeScreen device={device} />
        </details>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h2>
      {children}
    </section>
  );
}

function IosSteps({ url, stage }: { url: string; stage: AppLinks["stage"] }) {
  if (stage === "store") {
    return (
      <a href={url} className="btn btn-primary min-h-11" data-testid="get-app-ios">
        Download on the App Store
      </a>
    );
  }
  return (
    <ol className="space-y-3 text-sm" data-testid="get-app-ios-steps">
      <Step n={1}>
        <span>
          Get <b>TestFlight</b>, Apple&apos;s free app for trying new apps.
        </span>
        <a href={TESTFLIGHT_APP_URL} className="btn min-h-11 self-start" data-testid="get-app-testflight">
          Get TestFlight
        </a>
      </Step>
      <Step n={2}>
        <span>
          Join the HelixOS beta, then tap <b>Accept</b> and <b>Install</b>.
        </span>
        <a href={url} className="btn btn-primary min-h-11 self-start" data-testid="get-app-ios">
          Join the HelixOS beta
        </a>
      </Step>
      <Step n={3}>
        <span>Open HelixOS and sign in with your usual email and password.</span>
      </Step>
    </ol>
  );
}

function AndroidSteps({ url, stage }: { url: string; stage: AppLinks["stage"] }) {
  if (stage === "store") {
    return (
      <a href={url} className="btn btn-primary min-h-11" data-testid="get-app-android">
        Get it on Google Play
      </a>
    );
  }
  return (
    <ol className="space-y-3 text-sm" data-testid="get-app-android-steps">
      <Step n={1}>
        <span>
          Open HelixOS on Google Play and tap <b>Become a tester</b>.
        </span>
        <a href={url} className="btn btn-primary min-h-11 self-start" data-testid="get-app-android">
          Get HelixOS on Google Play
        </a>
      </Step>
      <Step n={2}>
        <span>Tap Install, then open HelixOS and sign in with your usual email and password.</span>
      </Step>
    </ol>
  );
}

function HomeScreen({ device }: { device: AppDevice }) {
  return (
    <p className="mt-2 text-sm text-ink-2" data-testid="get-app-home">
      {device === "android" ? (
        <>
          Meanwhile, in Chrome, open the menu <b>⋮</b> and choose <b>Add to Home screen</b>. HelixOS then opens full screen, like an app.
        </>
      ) : device === "ios" ? (
        <>
          Meanwhile, in Safari, tap <b>Share</b> and choose <b>Add to Home Screen</b>. HelixOS then opens full screen, like an app.
        </>
      ) : (
        <>Meanwhile, on your phone, you can add HelixOS to your home screen from the browser&apos;s menu. It then opens full screen, like an app.</>
      )}
    </p>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink" aria-hidden="true">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </li>
  );
}
