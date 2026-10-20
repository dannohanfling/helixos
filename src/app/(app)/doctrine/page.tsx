import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { frameworksFor } from "@/lib/frameworks";

export const metadata = { title: "Doctrine" };

export default async function DoctrinePage() {
  const v = await requireViewer();
  const coach = v.role === "coach" && !v.switchedInto;
  const [rows, frameworks] = await Promise.all([db.query.principles.findMany({ orderBy: asc(schema.principles.order) }), frameworksFor(v.workspace.id, coach)]);
  // The frameworks (H-1262): the how beside the why, by pillar; members see published ones, the coach drafts too, marked.
  const pillars = [...new Set(frameworks.map((f) => f.pillar ?? ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  const core = rows.filter((p) => p.order > 0);
  const extra = rows.filter((p) => p.order === 0);
  const tile = (p: (typeof rows)[number]) => (
    <Link key={p.code} href={`/doctrine/${encodeURIComponent(p.code)}`} className="card block p-4 transition hover:border-ink">
      <div className="flex items-center gap-2 text-xs text-ink-3">
        <span className="text-lg">{p.symbol ?? "Ω"}</span>
        <span>{p.order ? p.code : "Ω"}</span>
        {p.greekName ? <span>· {p.greekName}</span> : null}
      </div>
      <div className="mt-1 font-semibold leading-snug">{p.name}</div>
      {p.summary || p.doctrine || p.greekStory ? <p className="mt-1 line-clamp-3 text-sm text-ink-2">{(p.summary ?? p.doctrine ?? p.greekStory ?? "").split("\n")[0]}</p> : null}
      <div className="mt-2 text-[11px] text-ink-3">Post · Reel · Training</div>
    </Link>
  );
  return (
    <>
      <PageHeader title="Doctrine" subtitle="The principles the whole method runs on, and the frameworks that put them to work. Each one is a post, a reel, and a training waiting to happen." action={coach ? <Link href="/coach/frameworks" className="btn btn-ghost btn-sm" data-testid="doctrine-import-frameworks">Import frameworks</Link> : null} />
      {rows.length ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{core.map(tile)}</div>
          {extra.length ? (
            <Card className="mt-4" title="Further principles">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{extra.map(tile)}</div>
            </Card>
          ) : null}
        </>
      ) : (
        <Empty icon="🏛️" title="No principles yet" hint="Your coach hasn't published the principles yet. Check back after your next session." />
      )}
      {frameworks.length ? (
        <section className="mt-8" data-testid="doctrine-frameworks" data-count={frameworks.length}>
          <h2 className="text-lg font-semibold">The frameworks</h2>
          <p className="mb-3 text-sm text-ink-2">The how, step by step. The principles say why; these say what to do.</p>
          {pillars.map((pillar) => (
            <div key={pillar || "other"} className="mb-4" data-testid="doctrine-pillar" data-pillar={pillar}>
              {pillar ? <h3 className="label mb-2">{pillar}</h3> : pillars.length > 1 ? <h3 className="label mb-2">Other</h3> : null}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {frameworks
                  .filter((f) => (f.pillar ?? "") === pillar)
                  .map((f) => (
                    <Link key={f.id} href={`/doctrine/frameworks/${encodeURIComponent(f.slug)}`} className="card block p-4 transition hover:border-ink" data-testid="framework-tile" data-slug={f.slug} data-status={f.status}>
                      <div className="flex items-center gap-2 text-xs text-ink-3">
                        <span className="text-lg">🧩</span>
                        {f.rank ? <span>{f.rank}</span> : null}
                        {f.status !== "published" ? <Badge tone="warn">Draft</Badge> : null}
                        {f.hasPrice ? <Badge tone="danger">Names a price</Badge> : null}
                      </div>
                      <div className="mt-1 font-semibold leading-snug">{f.name}</div>
                      <p className="mt-1 line-clamp-3 text-sm text-ink-2">{f.idea}</p>
                      <div className="mt-2 text-[11px] text-ink-3">{f.steps.length} steps · Post · Reel · Training</div>
                    </Link>
                  ))}
              </div>
            </div>
          ))}
        </section>
      ) : coach ? (
        <Card className="mt-8" title="The frameworks">
          <p className="text-sm text-ink-2" data-testid="doctrine-frameworks-empty">
            None yet. <Link href="/coach/frameworks" className="underline">Import your reviewed Framework Library</Link>, then publish each one when it&apos;s ready.
          </p>
        </Card>
      ) : null}
    </>
  );
}
