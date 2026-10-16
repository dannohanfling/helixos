"use client";

import { useState } from "react";
import Link from "next/link";
import { dismissShippedNoticeAction } from "@/lib/actions/horizon";

/**
 * One time, in the app (H-385 §7): something the member said they wanted has shipped. A small card at the foot of the screen
 * with the item and a link to it on the horizon page; Got it stamps the want so it never shows again. No email; push later.
 */
export function HorizonNotice({ notice }: { notice: { itemId: string; title: string; line: string } }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const dismiss = () => {
    setGone(true);
    void dismissShippedNoticeAction(notice.itemId);
  };
  return (
    <div role="status" className="fixed inset-x-3 bottom-20 z-30 mx-auto max-w-md rounded-xl border bg-surface p-4 shadow-lg md:bottom-6 md:right-6 md:left-auto md:mx-0" data-testid="horizon-notice" data-item={notice.itemId}>
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">Something you wanted just shipped</p>
      <p className="mt-1 font-semibold">{notice.title}</p>
      <p className="text-sm text-ink-2">{notice.line}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/whats-new/horizon?item=${notice.itemId}#h-${notice.itemId}`} onClick={dismiss} className="btn btn-primary btn-sm" data-testid="horizon-notice-open">
          See it
        </Link>
        <button type="button" onClick={dismiss} className="btn btn-ghost btn-sm" data-testid="horizon-notice-dismiss">
          Got it
        </button>
      </div>
    </div>
  );
}
