"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dismissZoneNoticeAction, setZoneFromBrowserAction } from "@/lib/actions/zones";
import { zoneName } from "@/lib/dates";
import { canonicalZone, zoneNoticeText } from "@/lib/engine/zones";

const never = () => () => {};
const browserZone = () => canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "";

/**
 * The one-time line (H-457): "We're showing times in {zone}. Change it in Settings." A member who never had a zone gets their
 * browser's, saved once, and every page re-reads it; when the browser names none, the line says the coach's zone is in use.
 * Got it stamps it seen. A line at the top of the page, never over it. Never shown to a coach switched in or a team member
 * (the layout decides).
 */
export function ZoneNotice({ saved, workspaceTz }: { saved: string | null; workspaceTz: string }) {
  const router = useRouter();
  const [gone, setGone] = useState(false);
  const browser = useSyncExternalStore(never, browserZone, () => "");
  useEffect(() => {
    if (saved || !browser) return;
    void setZoneFromBrowserAction(browser).then((done) => {
      if (done) router.refresh();
    });
  }, [saved, browser, router]);
  if (gone) return null;
  const zone = saved || browser || workspaceTz;
  const fromWorkspace = !saved && !browser;
  const dismiss = () => {
    setGone(true);
    void dismissZoneNoticeAction();
  };
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-surface px-3 py-2" data-testid="zone-notice" data-zone={zone}>
      <p className="min-w-0 flex-1 text-sm">{zoneNoticeText(zone, zoneName(zone), fromWorkspace)}</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/settings#timezone" onClick={dismiss} className="btn btn-primary btn-sm" data-testid="zone-notice-settings">
          Change it in Settings
        </Link>
        <button type="button" onClick={dismiss} className="btn btn-ghost btn-sm" data-testid="zone-notice-dismiss">
          Got it
        </button>
      </div>
    </div>
  );
}
