import Link from "next/link";
import { and, count, desc, eq, like, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { setStoryStatusAction } from "@/lib/actions/teaching";
import { STATUS_WORDS, STORY_STATUSES, STORY_TYPES, momentOf, type StoryStatus } from "@/lib/engine/teaching";
import { TeachingUpload } from "@/components/teaching-upload";
import { Badge, Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Teaching library" };

const TYPE_WORDS: Record<string, string> = { story: "Story", framework: "Framework", number: "Number", line: "Line", client_result: "Client result", analogy: "Analogy" };
const PAGE = 50;

/**
 * Coach → Teaching library (rev 615 plan, rev 618 answers): upload the story bank and the library files, see what is in, and set
 * each story's status. Only "ready" stories ever reach the ladder writer, and only for the coach's own ladders.
 */
export default async function TeachingPage({ searchParams }: { searchParams: Promise<{ type?: string; status?: string; q?: string; page?: string; saved?: string }> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const type = (STORY_TYPES as readonly string[]).includes(sp.type ?? "") ? sp.type! : "";
  const status = (STORY_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as StoryStatus) : "";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const page = Math.max(1, Number(sp.page) || 1);
  const mine = eq(schema.storyItems.userId, v.user.id);
  const where = and(mine, type ? eq(schema.storyItems.type, type as (typeof STORY_TYPES)[number]) : undefined, status ? eq(schema.storyItems.status, status) : undefined, q ? or(like(schema.storyItems.title, `%${q}%`), like(schema.storyItems.what, `%${q}%`)) : undefined);
  const [library, byStatus, stories, total] = await Promise.all([
    db.select({ n: count() }).from(schema.teachingEntries).where(eq(schema.teachingEntries.userId, v.user.id)),
    db.select({ status: schema.storyItems.status, n: count() }).from(schema.storyItems).where(mine).groupBy(schema.storyItems.status),
    db.query.storyItems.findMany({ where, orderBy: [desc(schema.storyItems.updatedAt)], limit: PAGE, offset: (page - 1) * PAGE }),
    db.select({ n: count() }).from(schema.storyItems).where(where),
  ]);
  const files = await db.selectDistinct({ file: schema.teachingEntries.file }).from(schema.teachingEntries).where(eq(schema.teachingEntries.userId, v.user.id));
  const n = (s: StoryStatus) => byStatus.find((b) => b.status === s)?.n ?? 0;
  const link = (over: Record<string, string>) => `/coach/teaching?${new URLSearchParams({ ...(type ? { type } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}), ...over }).toString()}`;
  return (
    <>
      <PageHeader title="Teaching library" subtitle="Your answers and your story bank, read by the ladder writer for your own ladders only." action={<Link href="/coach" className="btn btn-ghost btn-sm">← Coach view</Link>} />
      <Card className="mb-4" title="Upload" id="upload">
        <p className="mb-3 text-sm text-ink-2">Choose the story bank and the library files together. Uploading again updates what changed and never doubles anything. A status you set here stays over the file&apos;s.</p>
        <TeachingUpload />
        <p className="mt-3 text-xs text-ink-3" data-testid="teaching-totals">
          In the library: {library[0]?.n ?? 0} answers from {files.length} file{files.length === 1 ? "" : "s"}. Story bank: {n("ready")} ready, {n("check")} to check, {n("needs_permission")} need permission.
        </p>
      </Card>
      <Card title={`Story bank · ${total[0]?.n ?? 0}`} id="stories">
        {sp.saved ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="story-saved">Saved.</p> : null}
        <form method="get" className="mb-3 flex flex-wrap items-end gap-2" data-testid="story-filters">
          <label className="text-xs">Type
            <select name="type" defaultValue={type} className="field mt-1 py-1 text-xs" data-testid="story-filter-type">
              <option value="">Every type</option>
              {STORY_TYPES.map((t) => <option key={t} value={t}>{TYPE_WORDS[t]}</option>)}
            </select>
          </label>
          <label className="text-xs">Status
            <select name="status" defaultValue={status} className="field mt-1 py-1 text-xs" data-testid="story-filter-status">
              <option value="">Every status</option>
              {STORY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
            </select>
          </label>
          <label className="text-xs">Words
            <input name="q" defaultValue={q} className="field mt-1 py-1 text-xs" placeholder="nightclub, first client…" data-testid="story-filter-q" />
          </label>
          <button className="btn btn-soft btn-sm" type="submit">Show</button>
        </form>
        {stories.length ? (
          <ul className="divide-y" data-testid="story-list">
            {stories.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start gap-3 py-3 text-sm" data-testid="story-row" data-status={s.status}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.title}</span>
                    <Badge tone="neutral">{TYPE_WORDS[s.type]}</Badge>
                    {s.hasPrice ? <Badge tone="warn">names a price: never given to the writer</Badge> : null}
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-line text-ink-2">{s.what}</p>
                  {s.goodFor ? <p className="mt-1 text-xs text-ink-3">Good for: {s.goodFor}</p> : null}
                  {s.fathomUrl ? (
                    <a href={s.fathomUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-accent underline" data-testid="story-source">
                      {[s.sourceCall, s.sourceDate].filter(Boolean).join(", ") || "The call"}{momentOf(s.fathomUrl) ? ` at ${momentOf(s.fathomUrl)}` : ""} ↗
                    </a>
                  ) : s.sourceCall || s.sourceDate ? <p className="mt-1 text-xs text-ink-3">{[s.sourceCall, s.sourceDate].filter(Boolean).join(", ")}</p> : null}
                </div>
                <form action={setStoryStatusAction} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="back" value={link({ page: String(page) })} />
                  <select name="status" defaultValue={s.status} aria-label={`Status of ${s.title}`} className="field py-1 text-xs" data-testid="story-status">
                    {STORY_STATUSES.map((x) => <option key={x} value={x}>{STATUS_WORDS[x]}</option>)}
                  </select>
                  <SubmitButton className="btn btn-ghost btn-xs" pendingText="Saving…" data-testid="story-status-save">Save</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">{total[0]?.n ? "Nothing matches those filters." : "No stories yet. Upload the story bank above."}</p>
        )}
        {(total[0]?.n ?? 0) > page * PAGE ? <Link href={link({ page: String(page + 1) })} className="mt-3 inline-block text-sm underline" data-testid="story-next">Next {PAGE} →</Link> : null}
      </Card>
    </>
  );
}
