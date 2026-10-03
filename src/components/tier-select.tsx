"use client";

import { setClientTierAction } from "@/lib/actions/coach";
import { SubmitButton } from "@/components/submit-button";

/**
 * A client's program tier on the coach's table (rev 442): its own form, saved the moment it changes, with the green "Saved ✓"
 * every form shows. The change presses the shared button, which stays out of sight, so the save is sent the one way every
 * other save is, and a second change while the first is out waits its turn.
 */
export function TierSelect({ membershipId, value, tiers, name }: { membershipId: string; value: string; tiers: readonly string[]; name: string }) {
  return (
    <form action={setClientTierAction} className="inline-flex items-center gap-1" data-testid="tier-form">
      <input type="hidden" name="membershipId" value={membershipId} />
      <select
        className="field w-auto min-w-[8.5rem] py-1 text-xs"
        name="programTier"
        defaultValue={value}
        aria-label={`${name}'s tier`}
        data-testid="tier-select"
        onChange={(e) => e.currentTarget.form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()}
      >
        {tiers.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <SubmitButton className="sr-only" pendingText="Saving…" tabIndex={-1} aria-hidden="true">
        Save tier
      </SubmitButton>
    </form>
  );
}
