import { requireViewer } from "@/lib/auth";
import { helixFor } from "@/lib/my-helix";
import { after } from "next/server";
import { syncTools } from "@/lib/tools-open";
import { MyHelix } from "@/components/my-helix";
import "@/components/my-helix.css";

export const metadata = { title: "My Helix" };

/**
 * My Helix (rev 707 with rev 710's curriculum): a turning double helix of the member's progress through the program, 67 rungs
 * over ten phases from the bottom up. Each rung reads a signal HelixOS already has, or the member's own tick.
 */
export default async function MyHelixPage() {
  const v = await requireViewer();
  const h = await helixFor(v);
  // Tools open as a client reaches them (H-164 §12): what this page just read opens the menu's pages up to the phase reached.
  if (!v.team) after(() => syncTools(v, h));
  return (
    <div className="hx-page" data-testid="my-helix">
      <MyHelix
        rungs={h.rungs.map((r) => ({ key: r.key, phase: r.phase, label: r.label, done: r.done, tick: r.tick, ticked: r.ticked, href: r.href, words: r.words }))}
        phases={h.phases.map((p) => ({ n: p.n, name: p.name, main: p.main, dark: p.dark, done: p.done, total: p.rungs.length }))}
        next={h.next ? { key: h.next.key, label: h.next.label, phase: h.next.phase, href: h.next.href } : null}
        built={h.built}
        total={h.total}
        pct={h.pct}
        initialPaused={h.paused}
        fresh={h.fresh}
        own={!v.switchedInto}
      />
    </div>
  );
}
