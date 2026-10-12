"use client";

import { useState } from "react";
import { looksLikePerson } from "@/lib/engine/board-seats";

/**
 * A custom seat's name and its "named after a real person" tick (rev 756 §3): the tick follows the name while it looks like a
 * person's ("First Last"), until the member sets it themselves.
 */
export function CustomSeatName({ name, realPerson }: { name: string; realPerson: boolean | null }) {
  const [value, setValue] = useState(name);
  const [tick, setTick] = useState<boolean | null>(realPerson);
  const checked = tick ?? looksLikePerson(value);
  return (
    <>
      <label className="block">
        <span className="label">Name</span>
        <input className="field" name="name" maxLength={60} value={value} onChange={(e) => setValue(e.target.value)} required data-testid="council-custom-name" />
        <span className="mt-1 block text-xs text-ink-3">Named after a real person? It ends in &quot;style&quot;, for example &quot;Marie Forleo style&quot;; it&apos;s added if you leave it off.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="realPerson" value="1" checked={checked} onChange={(e) => setTick(e.target.checked)} data-testid="council-custom-real" />
        <span>Named after a real person. Without sources below, it runs as &quot;my read&quot; only.</span>
      </label>
    </>
  );
}
