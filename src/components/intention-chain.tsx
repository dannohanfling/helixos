import Link from "next/link";
import { linkWeekAction } from "@/lib/actions/intentions";
import type { Chain, PlanChoice } from "@/lib/intention-chain";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * The intention chain (H-195 #14, H-198): Initiative → this month's intention → this week's → its tasks → its key results, each a
 * tap, as a plain list. Below it, the one place to link this week to Business goals: nothing is linked until the member picks
 * and presses Link.
 */
export function IntentionChain({ chain, choices, links, back = "/intentions", linked = false, canLink = true }: { chain: Chain; choices: { initiatives: PlanChoice[]; keyResults: PlanChoice[] }; links: { initiativeId: string | null; krIds: (string | null)[] }; back?: string; linked?: boolean; canLink?: boolean }) {
  const step = (label: string, body: React.ReactNode, testId: string) => (
    <li className="flex flex-wrap items-baseline gap-x-2" data-testid={testId}>
      <span className="w-36 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</span>
      <span className="min-w-0">{body}</span>
    </li>
  );
  const none = <span className="text-ink-3">Not set yet</span>;
  return (
    <section id="chain" className="mb-5 scroll-mt-4" data-testid="intention-chain">
      <Card title="Your chain" action={<span className="text-xs text-ink-3">How this week adds up</span>}>
        {linked ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="chain-linked">Linked. Your week now rolls up under it.</p> : null}
        <ol className="space-y-2 text-sm" data-testid="chain-steps">
          {step("Initiative", chain.initiative ? <Link className="font-medium underline" href={`/goals/${chain.initiative.id}`}>{chain.initiative.title}</Link> : <span className="text-ink-3">Not linked yet</span>, "chain-initiative")}
          {step("This month", chain.month ? <Link className="underline" href="/intentions#month">{chain.month.word}</Link> : none, "chain-month")}
          {step("This week", chain.week ? <Link className="underline" href="/intentions#week">{chain.week.word}</Link> : none, "chain-week")}
          {step("Tasks", chain.week ? <Link className="underline" href="/tasks">{chain.tasks.done} of {chain.tasks.total} done</Link> : none, "chain-tasks")}
          {step(
            "Key results moved",
            chain.keyResults.length ? (
              <span>
                {chain.moved} of {chain.keyResults.length}
                {chain.keyResults.some((k) => k.kr) ? (
                  <ul className="mt-1 space-y-0.5 text-ink-2">
                    {chain.keyResults.map((k, i) =>
                      k.kr ? (
                        <li key={i}>
                          {k.text} → <Link className="underline" href={`/goals/${k.kr.id}`}>{k.kr.title}</Link>
                          {k.actual !== null ? ` (${k.actual} logged)` : ""}
                        </li>
                      ) : null,
                    )}
                  </ul>
                ) : null}
              </span>
            ) : (
              none
            ),
            "chain-key-results",
          )}
        </ol>
        {chain.week && canLink ? (
          choices.initiatives.length || choices.keyResults.length ? (
            <details className="mt-4 rounded-lg border p-3" open={!links.initiativeId && !linked} data-testid="chain-link">
              <summary className="cursor-pointer text-sm font-medium">{links.initiativeId ? "Change what this week links to" : "Link this week to Business goals"}</summary>
              <form action={linkWeekAction} className="mt-3 space-y-3 text-sm">
                <input type="hidden" name="weekId" value={chain.week.id} />
                <input type="hidden" name="back" value={back} />
                <label className="block">
                  <span className="label">The initiative this week moves</span>
                  <select className="field" name="initiativeId" defaultValue={links.initiativeId ?? ""} data-testid="chain-initiative-pick">
                    <option value="">Not linked</option>
                    {choices.initiatives.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                </label>
                {chain.keyResults.map((k, i) => (
                  <label key={i} className="block">
                    <span className="label">&ldquo;{k.text}&rdquo; counts toward</span>
                    <select className="field" name={`kr${i + 1}`} defaultValue={links.krIds[i] ?? ""} data-testid={`chain-kr${i + 1}-pick`}>
                      <option value="">No key result</option>
                      {choices.keyResults.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <p className="text-xs text-ink-3">On Friday, the number you write for a linked key result is logged there, dated that day. Nothing is guessed.</p>
                <SubmitButton className="btn btn-primary btn-sm" pendingText="Linking…" data-testid="chain-link-save">
                  Link
                </SubmitButton>
              </form>
            </details>
          ) : (
            <p className="mt-3 text-sm text-ink-2" data-testid="chain-no-plan">
              Add an initiative in <Link className="underline" href="/goals">Business goals</Link> to link your week to it.
            </p>
          )
        ) : null}
      </Card>
    </section>
  );
}
