import { requireViewer } from "@/lib/auth";
import { reframesByGroup } from "@/lib/engine/socrates";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Reframe library" };

/** Grouped by the objection in front of you: at the Diffuse step you choose from the few that fit, not a flat list. */
export default async function ReframesPage() {
  await requireViewer();
  const groups = reframesByGroup();
  return (
    <>
      <PageHeader title="Reframe library" subtitle="Clarify → Discuss → Diffuse. At Diffuse, pick from the group that matches the objection." />
      <div className="space-y-6" data-testid="reframe-groups">
        {groups.map((g) => (
          <section key={g.group} data-testid="reframe-group" data-group={g.group}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
              {g.group} <Badge>{g.reframes.length}</Badge>
            </h2>
            <div className="grid gap-3 lg:grid-cols-3">
              {g.reframes.map((r) => (
                <Card key={r.id} title={r.name} action={<CopyButton text={`${r.transitionIn} ${r.memorablePhrase} ${r.metaphor}`} label="Copy" className="btn btn-ghost btn-xs" />}>
                  <article data-testid="reframe" data-id={r.id} className="space-y-2 text-sm">
                    <p className="text-base font-semibold leading-snug">{r.memorablePhrase}</p>
                    <p className="leading-relaxed">{r.metaphor}</p>
                    <p className="text-ink-2">{r.simpleExplanation}</p>
                    <p><span className="label">Transition in</span> <span className="italic">{r.transitionIn}</span></p>
                    <p><span className="label">When to use</span> {r.whenToUse}</p>
                    {r.credit ? <p className="text-xs text-ink-3" data-testid="reframe-credit">Credit: {r.credit}</p> : null}
                  </article>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
