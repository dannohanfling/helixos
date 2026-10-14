import { requireCoach } from "@/lib/auth";
import { rungDefs } from "@/lib/my-helix";
import { PHASES, SIGNALS } from "@/lib/engine/my-helix";
import { PageHeader } from "@/components/ui";
import { RungRow } from "@/components/helix-rung-row";

export const metadata = { title: "My Helix rungs" };

/** The coach's rung list (rev 707 §4): the 67 rungs as data, each with its name, order, link and the signal it reads. */
export default async function CoachHelixPage() {
  await requireCoach();
  const rungs = await rungDefs();
  return (
    <div className="space-y-6" data-testid="coach-helix">
      <PageHeader title="My Helix rungs" subtitle="The 67 rungs every member climbs, as data: rename one, move it, change its link or what it reads, with no deploy." />
      <p className="text-sm opacity-80">A rung reads a signal HelixOS already has, or a tick by the member (or you, switched in). Nothing is inferred: when in doubt, make it a tick.</p>
      {PHASES.map((p) => (
        <section key={p.n} className="card p-4 space-y-3" data-testid={`coach-helix-phase-${p.n}`}>
          <h2 className="text-lg font-semibold">
            <span className="inline-block h-3 w-3 rounded-full align-middle mr-2" style={{ background: p.main }} aria-hidden="true" />
            {p.n}. {p.name}
          </h2>
          <div className="space-y-2">
            {rungs
              .filter((r) => r.phase === p.n)
              .map((r) => (
                <RungRow key={r.key} rung={r} signals={SIGNALS} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
