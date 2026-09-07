"use client";

import { useEffect, useState } from "react";
import { markTierCelebratedAction } from "@/lib/actions/tiers";

/**
 * The moment a member crosses into a new tier, once. A member whose celebrated level was never recorded (everyone before
 * this shipped) is stamped silently at their current tier so nobody is congratulated for where they already were.
 */
export function LevelUp({ tier, celebrated }: { tier: { level: number; name: string; icon: string; welcome: string | null }; celebrated: number | null }) {
  const fresh = celebrated !== null && tier.level > celebrated;
  const [open, setOpen] = useState(fresh);
  useEffect(() => {
    if (celebrated === null || fresh) void markTierCelebratedAction(tier.level);
  }, [celebrated, fresh, tier.level]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="levelup-title" data-testid="level-up">
      <div className="level-up-confetti" aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => (
          <span key={i} style={{ left: `${(i * 53) % 100}%`, animationDelay: `${(i % 6) * 0.15}s`, background: ["#b7791f", "#f0c56a", "#7a4f0f", "#ffffff"][i % 4] }} />
        ))}
      </div>
      <div className="level-up-card card w-full max-w-sm p-6 text-center">
        <div className="text-5xl">{tier.icon}</div>
        <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-3">New level</div>
        <h2 id="levelup-title" className="mt-1 text-2xl font-bold">
          You reached {tier.name}
        </h2>
        {tier.welcome ? <p className="mt-3 text-sm text-ink-2">{tier.welcome}</p> : null}
        <button type="button" className="btn btn-accent mt-5 w-full" onClick={() => setOpen(false)} autoFocus>
          Keep going
        </button>
      </div>
    </div>
  );
}
