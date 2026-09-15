"use client";

import { useEffect, useState } from "react";
import { channelOutcomesAction } from "@/lib/actions/outcomes";
import type { ChannelOutcome } from "@/lib/engine/channel-outcome";
import { OutcomeHeadline, OutcomeRows } from "./channel-outcome";

/**
 * The composer's answer, right after scheduling, while the text is still in front of the client: one row per channel,
 * read from the same source as the card and the Distribute page. The pushes run after the response, so it asks again a few
 * times while any row is still sending, then stops; a row that never resolves becomes "Lost track" on later views.
 */
const AGAIN_MS = [800, 2500, 6000, 12000, 20000];

export function ChannelOutcomePanel({ contentId }: { contentId: string }) {
  const [outcomes, setOutcomes] = useState<ChannelOutcome[] | null>(null);
  useEffect(() => {
    let alive = true;
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const r = await channelOutcomesAction(contentId).catch(() => null);
      if (!alive) return;
      if (r) setOutcomes(r);
      const pending = !r || r.some((o) => o.state === "sending");
      if (pending && i < AGAIN_MS.length) timer = setTimeout(ask, AGAIN_MS[i++]);
    };
    void ask();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [contentId]);
  if (!outcomes) return <p className="mt-2 text-xs text-ink-3">Checking each channel…</p>;
  return (
    <div className="mt-2 rounded-lg border bg-surface p-2" data-testid="compose-outcomes">
      <OutcomeHeadline outcomes={outcomes} className="text-sm font-medium" />
      <OutcomeRows outcomes={outcomes} compact />
    </div>
  );
}
