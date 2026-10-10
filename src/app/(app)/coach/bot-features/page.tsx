import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { rulesFor } from "@/lib/bot-features";
import { BEHAVIORS, BEHAVIOR_SOURCE, BEHAVIOR_WORDS, BOT_FEATURES, DEFAULT_RULES, UNLOCK_TYPES } from "@/lib/engine/bot-features";
import { TIERS } from "@/lib/engine/tiers";
import { saveBotRulesAction } from "@/lib/actions/bot-features";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Bot Features rules" };

const TYPE_WORDS: Record<(typeof UNLOCK_TYPES)[number], string> = { free: "Free", behavior: "A milestone", tier: "A tier", points: "Points reached" };

/**
 * How each Bot Feature unlocks in this workspace (rev 618): one rule per feature, a type and a value, so the coach changes it
 * without code. Points are a threshold reached, never spent. A milestone HelixOS can't see is ticked on the client's page.
 */
export default async function BotRulesPage({ searchParams }: { searchParams: Promise<{ saved?: string; bad?: string }> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const rules = await rulesFor(v.workspace.id);
  return (
    <>
      <PageHeader title="Bot Features rules" subtitle="How each feature unlocks for your clients. Bot Features never spend points." action={<Link href="/coach#bot-features" className="btn btn-ghost btn-sm">← Coach view</Link>} />
      {sp.saved ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="rules-saved">Saved.</p> : null}
      {sp.bad ? <p className="mb-3 rounded-lg bg-warn-soft p-2 text-sm" role="alert" data-testid="rules-bad">Not saved, left as they were: {sp.bad}. A points rule needs a whole number.</p> : null}
      <Card>
        <form action={saveBotRulesAction} data-testid="rules-form">
          <ul className="divide-y">
            {BOT_FEATURES.map((f) => {
              const r = rules[f.key];
              const d = DEFAULT_RULES[f.key];
              return (
                <li key={f.key} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-end" data-testid="rule-row" data-key={f.key}>
                  <div>
                    <div className="font-medium">{f.name}{f.comingSoon ? <span className="ml-2 text-xs text-ink-3">coming soon</span> : null}</div>
                    <div className="text-xs text-ink-3">Default: {d.type === "behavior" ? BEHAVIOR_WORDS[d.value as (typeof BEHAVIORS)[number]] : d.type === "tier" ? `reach ${d.value} tier` : d.type === "points" ? `${d.value} points` : "free"}</div>
                  </div>
                  <label className="text-xs">
                    Unlocks by
                    <select name={`${f.key}_type`} defaultValue={r.type} className="field mt-1 py-1 text-sm" data-testid={`rule-type-${f.key}`}>
                      {UNLOCK_TYPES.map((t) => (
                        <option key={t} value={t}>{TYPE_WORDS[t]}</option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-3 gap-2 text-xs sm:w-[30rem]">
                    <label>
                      Milestone
                      <select name={`${f.key}_behavior`} defaultValue={r.type === "behavior" ? r.value : d.type === "behavior" ? d.value : BEHAVIORS[0]} className="field mt-1 py-1 text-sm" data-testid={`rule-behavior-${f.key}`}>
                        {BEHAVIORS.map((b) => (
                          <option key={b} value={b}>{BEHAVIOR_WORDS[b]} ({BEHAVIOR_SOURCE[b]})</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Tier
                      <select name={`${f.key}_tier`} defaultValue={r.type === "tier" ? r.value : "Sage"} className="field mt-1 py-1 text-sm" data-testid={`rule-tier-${f.key}`}>
                        {TIERS.map((t) => (
                          <option key={t.name} value={t.name}>{t.name} ({t.minPoints.toLocaleString()})</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Points
                      <input name={`${f.key}_points`} defaultValue={r.type === "points" ? r.value : ""} inputMode="numeric" className="field mt-1 py-1 text-sm" placeholder="e.g. 500" data-testid={`rule-points-${f.key}`} />
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-ink-3">The value beside the type you pick is the one that counts; the others are ignored.</p>
          <SubmitButton className="btn btn-primary btn-sm mt-3" pendingText="Saving…" data-testid="rules-save">Save rules</SubmitButton>
        </form>
      </Card>
    </>
  );
}
