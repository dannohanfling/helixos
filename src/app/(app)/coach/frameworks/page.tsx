import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { frameworksFor } from "@/lib/frameworks";
import { setFrameworkStatusAction } from "@/lib/actions/frameworks";
import { FrameworksImport } from "@/components/frameworks-import";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Frameworks" };

/**
 * Coach → Frameworks (H-1262, plan H-1270): import the reviewed Framework Library with a dry run first, then publish each one
 * when it's ready. A re-import updates in place by slug. A framework that names a price can't be published.
 */
export default async function CoachFrameworksPage({ searchParams }: { searchParams: Promise<{ status?: string; saved?: string; error?: string }> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const all = await frameworksFor(v.workspace.id, true);
  const status = sp.status === "draft" || sp.status === "published" ? sp.status : "";
  const rows = status ? all.filter((f) => f.status === status) : all;
  const published = all.filter((f) => f.status === "published").length;
  const back = `/coach/frameworks${status ? `?status=${status}` : ""}`;
  return (
    <>
      <PageHeader title="Frameworks" subtitle="Your reviewed Framework Library, imported here and published one by one. Members see the published ones under Doctrine." action={<Link href="/doctrine" className="btn btn-ghost btn-sm">See Doctrine</Link>} />
      <Card className="mb-4" title="Import" id="import">
        <p className="mb-3 text-sm text-ink-2">
          Paste the markdown from your Framework Library, or choose the file: one <code>##</code> heading per framework, then Pillar, Rank, The idea, The steps (numbered), When to use it, Common mistakes, Story or analogy, In Danno&apos;s words, Source, Content angles, Evolution, Status and Borrowed from, each as <code>Field: value</code>. Run a dry run first; nothing is saved until you press Save. A framework that names a price is held as a draft.
        </p>
        <FrameworksImport />
      </Card>
      <Card title="Your frameworks" action={<span data-testid="frameworks-count"><Badge tone="neutral">{published} of {all.length} published</Badge></span>}>
        {sp.saved ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="framework-saved">Saved.</p> : null}
        {sp.error ? <p className="mb-3 rounded-lg bg-danger-soft p-2 text-sm" role="alert" data-testid="framework-error">{sp.error}</p> : null}
        <form method="get" className="mb-3 flex flex-wrap items-end gap-2" data-testid="framework-filters">
          <label className="text-xs">
            Status
            <select name="status" defaultValue={status} className="field mt-1 py-1 text-xs" data-testid="framework-filter-status">
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </label>
          <SubmitButton className="btn btn-ghost btn-xs" pendingText="…">Filter</SubmitButton>
        </form>
        {rows.length ? (
          <ul className="divide-y" data-testid="framework-list">
            {rows.map((f) => (
              <li key={f.id} className="flex flex-wrap items-start gap-3 py-3 text-sm" data-testid="framework-row" data-slug={f.slug} data-status={f.status}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/doctrine/frameworks/${encodeURIComponent(f.slug)}`} className="font-medium hover:underline">{f.name}</Link>
                    {f.pillar ? <span className="text-xs text-ink-3">{f.pillar}</span> : null}
                    {f.rank ? <span className="text-xs text-ink-3">· {f.rank}</span> : null}
                    <Badge tone={f.status === "published" ? "good" : "neutral"}>{f.status === "published" ? "Published" : "Draft"}</Badge>
                    {f.hasPrice ? <Badge tone="danger">Names a price</Badge> : null}
                    {f.borrowedFrom ? <span className="text-xs text-ink-3">after {f.borrowedFrom}</span> : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{f.idea}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{f.steps.length} steps{f.sourceCall || f.sourceDate ? ` · ${[f.sourceCall, f.sourceDate].filter(Boolean).join(", ")}` : ""}</p>
                </div>
                <form action={setFrameworkStatusAction} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={f.id} />
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="status" value={f.status === "published" ? "draft" : "published"} />
                  <SubmitButton className="btn btn-ghost btn-xs" pendingText="Saving…" data-testid="framework-toggle">
                    {f.status === "published" ? "Unpublish" : "Publish"}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3" data-testid="framework-list-empty">{all.length ? "None with that status." : "None yet. Import the file above."}</p>
        )}
      </Card>
    </>
  );
}
