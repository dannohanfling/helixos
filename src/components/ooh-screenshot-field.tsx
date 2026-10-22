"use client";

import { useState } from "react";
import { ScreenshotPicker, type Shot } from "@/components/screenshot-picker";

/**
 * The Office Hours request's optional screenshot (H-1706), under "Describe the issue": upload a picture or capture this screen,
 * shrunk to fit and sent with the form. Editing a request shows the picture it has, kept unless a new one replaces it or
 * "Remove this picture" is ticked. A capture can show other people's details, so the line under it says to hide them.
 */
export function OohScreenshotField({ idPrefix, existing }: { idPrefix: string; existing?: { url: string } | null }) {
  const [shot, setShot] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remove, setRemove] = useState(false);
  return (
    <div className="space-y-2 text-sm" data-testid={`${idPrefix}-shot-field`}>
      <div className="font-medium">
        Add a screenshot <span className="font-normal text-ink-3">(optional)</span>
      </div>
      {existing && !shot ? (
        <div className="flex flex-wrap items-center gap-3">
          <a href={existing.url} target="_blank" rel="noopener" data-testid={`${idPrefix}-current`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the member's own picture through the private route, never a remote one */}
            <img src={existing.url} alt="The screenshot on this request" loading="lazy" decoding="async" className={`max-h-24 rounded-lg border ${remove ? "opacity-40" : ""}`} />
          </a>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="screenshotRemove" value="yes" checked={remove} onChange={(e) => setRemove(e.currentTarget.checked)} data-testid={`${idPrefix}-remove`} /> Remove this picture
          </label>
        </div>
      ) : null}
      <ScreenshotPicker idPrefix={idPrefix} shot={shot} onShot={setShot} error={error} onError={setError} name="screenshotData" previewAlt="The screenshot that will go with this request" />
      <p className="text-xs text-ink-3">A capture can show other people&apos;s names or numbers. Hide anyone&apos;s details who hasn&apos;t agreed.</p>
    </div>
  );
}
