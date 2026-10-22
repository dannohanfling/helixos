import { requireViewer } from "@/lib/auth";
import { helixFor } from "@/lib/my-helix";
import { after } from "next/server";
import { syncTools } from "@/lib/tools-open";
import { MyHelix } from "@/components/my-helix";
import "@/components/my-helix.css";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { nextPathwayTask } from "@/lib/queries/today";
import { FIELD_TASKS } from "@/lib/engine/pathway";
import { Card } from "@/components/ui";

export const metadata = { title: "My Helix" };

/**
 * My Helix (rev 707 with rev 710's curriculum): a turning double helix of the member's progress through the program, 67 rungs
 * over ten phases from the bottom up. Each rung reads a signal HelixOS already has, or the member's own tick.
 */
export default async function MyHelixPage() {
  const v = await requireViewer();
  // Next on your pathway and Your brand moved here from Today (H-164 §14): the longer road sits with the progress.
  const [h, pathwayNext, brandKit] = await Promise.all([
    helixFor(v),
    v.role === "client" ? nextPathwayTask(v.user.id) : Promise.resolve(null),
    v.role === "client" ? db.query.brandKits.findFirst({ where: and(eq(schema.brandKits.workspaceId, v.workspace.id), eq(schema.brandKits.userId, v.user.id)), columns: { id: true } }) : Promise.resolve(true),
  ]);
  // Tools open as a client reaches them (H-164 §12): what this page just read opens the menu's pages up to the phase reached.
  if (!v.team) after(() => syncTools(v, h));
  return (
    <div className="hx-page" data-testid="my-helix">
      <MyHelix
        rungs={h.rungs.map((r) => ({ key: r.key, phase: r.phase, label: r.label, done: r.done, tick: r.tick, ticked: r.ticked, href: r.href, words: r.words, note: r.note, reason: r.reason }))}
        phases={h.phases.map((p) => ({ n: p.n, name: p.name, main: p.main, dark: p.dark, done: p.done, total: p.rungs.length }))}
        next={h.next ? { key: h.next.key, label: h.next.label, phase: h.next.phase, href: h.next.href } : null}
        built={h.built}
        total={h.total}
        pct={h.pct}
        initialPaused={h.paused}
        fresh={h.fresh}
        own={!v.switchedInto}
      />
      {pathwayNext || !brandKit ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2" data-testid="helix-up-next">
          {pathwayNext ? (
            <Card title="Next on your pathway" action={<Link href="/pathway" className="text-xs text-ink-2 hover:underline">Pathway →</Link>}>
              <Link href={FIELD_TASKS[pathwayNext.key]?.href ?? `/pathway?task=${pathwayNext.key}`} className="font-semibold hover:underline" data-testid="pathway-next">
                {pathwayNext.name}
              </Link>
              <div className="mt-1 text-xs text-ink-3">+{pathwayNext.points} pts when your coach verifies it</div>
            </Card>
          ) : null}
          {!brandKit ? (
            <Card title="Your brand" action={<Link href="/settings?tab=brand#brand-kit" className="text-xs text-ink-2 hover:underline">Settings →</Link>}>
              <Link href="/settings?tab=brand#brand-kit" className="font-semibold hover:underline" data-testid="brand-kit-nudge">
                Set your brand kit (5 min)
              </Link>
              <div className="mt-1 text-xs text-ink-3">Your colours, fonts and logo. Until then your decks use the house starter kit.</div>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
