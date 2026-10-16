import { eq, desc, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { setupDefs } from "@/lib/setup-card";
import { SETUP_GROUPS, SETUP_SIGNALS } from "@/lib/engine/setup";
import { Card, PageHeader } from "@/components/ui";
import { SetupStepRow } from "@/components/setup-step-row";
import { StartHereSlot } from "@/components/start-here-slot";

export const metadata = { title: "Setup steps" };

/** The coach's setup list (H-270 §1): the 26 steps as data, each with its group, order, link, what it reads, what it needs first and its minutes; and the Start Here video slot. */
export default async function CoachSetupPage() {
  const coach = await requireCoach();
  const steps = await setupDefs();
  const recordings = await db.query.recordings.findMany({ where: and(eq(schema.recordings.workspaceId, coach.workspace.id), eq(schema.recordings.status, "published")), orderBy: desc(schema.recordings.startedAt), limit: 50, columns: { title: true, clearTitle: true, url: true, shareUrl: true } });
  return (
    <div className="space-y-6" data-testid="coach-setup">
      <PageHeader title="Setup steps" subtitle="The 26 setup steps every new member walks, as data: rename one, move it, change its link, what it reads or what it needs first, with no deploy." />
      <Card title="Start Here: your welcome video (S1a)">
        <StartHereSlot url={coach.workspace.startHereVideo ?? null} recordings={recordings.map((r) => ({ title: r.clearTitle || r.title, url: r.shareUrl || r.url })).filter((r) => r.url)} />
      </Card>
      <p className="text-sm opacity-80">A step reads a signal HelixOS already has, or a tick by the member (or you, switched in). The two coach steps count your tick alone. Needs first takes step keys (s1, s7); a step opens on Today once each of them is done. The card counts the first three groups and retires when they are done.</p>
      {SETUP_GROUPS.map((g) => (
        <section key={g.key} className="card p-4 space-y-3" data-testid={`coach-setup-group-${g.key}`}>
          <h2 className="text-lg font-semibold">{g.name}</h2>
          <div className="space-y-2">
            {steps
              .filter((s) => s.group === g.key)
              .map((s) => (
                <SetupStepRow key={s.key} step={s} signals={SETUP_SIGNALS} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
