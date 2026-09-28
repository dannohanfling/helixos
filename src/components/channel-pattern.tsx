"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The link pattern box on /coach/community, for whichever channel is picked in the same form (28 Sep, live): each channel has
 * its own address, so picking another channel shows that channel's saved pattern (or an empty box), never the last one's.
 */
export function ChannelPattern({ patterns, channel }: { patterns: Record<string, string>; channel: string }) {
  const here = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(patterns[channel] ?? "");
  useEffect(() => {
    const select = here.current?.form?.querySelector<HTMLSelectElement>('select[name="channel"]');
    if (!select) return;
    const onChange = () => setValue(patterns[select.value] ?? "");
    select.addEventListener("change", onChange);
    return () => select.removeEventListener("change", onChange);
  }, [patterns]);
  return (
    <input
      ref={here}
      className="field mt-1"
      name="linkPattern"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="https://your-community/…/channels/<channel>/posts/{postId}"
      data-testid="community-link-pattern"
    />
  );
}
