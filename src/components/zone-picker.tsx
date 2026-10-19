"use client";

import { useState, useSyncExternalStore } from "react";
import { canonicalZone } from "@/lib/engine/zones";

const never = () => () => {};
const browserZone = () => canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "";

/**
 * Settings' time zone (H-457): a searchable list of every zone; type a city or a region and pick. A member who never chose one
 * starts on their browser's zone, else the coach's. The server checks what comes back and keeps the old zone on a typo.
 */
export function ZonePicker({ saved, workspaceTz, zones }: { saved: string | null; workspaceTz: string; zones: string[] }) {
  const browser = useSyncExternalStore(never, browserZone, () => "");
  const [typed, setTyped] = useState<string | null>(null);
  const value = typed ?? (saved || browser || workspaceTz);
  return (
    <>
      <input className="field" id="timezone" name="timezone" list="zone-list" value={value} onChange={(e) => setTyped(e.target.value)} onFocus={(e) => e.currentTarget.select()} autoComplete="off" spellCheck={false} data-testid="zone-picker" />
      <datalist id="zone-list">
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}
