import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { Card, Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Doctrine" };

export default async function DoctrinePage() {
  await requireViewer();
  const rows = await db.query.principles.findMany({ orderBy: asc(schema.principles.order) });
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
      <PageHeader title="Doctrine" subtitle="The principles the whole method runs on. Each one is a post, a reel, and a training waiting to happen." />
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
    </>
  );
}
