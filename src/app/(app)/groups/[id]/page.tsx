import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { deleteGroupAction, markPostedInGroupAction, updateGroupAction } from "@/lib/actions/groups";
import { Badge, Card, Field, PageHeader, Progress } from "@/components/ui";
import { alignPost, groupReadiness, readRules } from "@/lib/engine/groups";
import { formatDate } from "@/lib/dates";

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const g = await db.query.groups.findFirst({ where: and(eq(schema.groups.id, id), eq(schema.groups.userId, v.user.id)) });
  if (!g) notFound();
  const [variants, recent] = await Promise.all([
    db.query.contentVariants.findMany({ where: and(eq(schema.contentVariants.userId, v.user.id), eq(schema.contentVariants.groupId, id)), orderBy: desc(schema.contentVariants.createdAt), limit: 10 }),
    db.query.contentItems.findMany({ where: eq(schema.contentItems.userId, v.user.id), orderBy: desc(schema.contentItems.createdAt), limit: 5 }),
  ]);
  const itemIds = variants.map((x) => x.contentItemId);
  const items = itemIds.length ? await db.query.contentItems.findMany({ where: eq(schema.contentItems.userId, v.user.id) }) : [];
  const titleOf = new Map(items.map((i) => [i.id, i.title]));
  const ready = groupReadiness(g);
  const rules = readRules(g);
  const sample = recent[0];
  const preview = sample ? alignPost({ title: sample.title, hook: sample.hook, body: sample.body, hasCta: sample.hasCta }, g) : null;
  const kindLabel = g.kind === "own" ? "My group" : g.kind === "prospect" ? (g.rank ? `Prospect #${g.rank}` : "Prospect (bench)") : "Member";
  return (
    <>
      <PageHeader
        title={g.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/groups" className="hover:underline">← Groups</Link>
            <Badge tone={g.kind === "own" ? "good" : g.kind === "prospect" ? "accent" : "neutral"}>{kindLabel}</Badge>
            {g.url ? <a href={g.url} target="_blank" rel="noreferrer" className="underline">Open on Facebook ↗</a> : null}
          </span>
        }
        action={
          <form action={markPostedInGroupAction}>
            <input type="hidden" name="id" value={g.id} />
            <button className="btn btn-soft btn-sm" type="submit">I posted here today</button>
          </form>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card title="Group profile" action={<span className="text-xs text-ink-3">{ready}% complete</span>}>
          <div className="mb-3"><Progress value={ready} tone={ready >= 75 ? "good" : ready >= 40 ? "accent" : "warn"} /></div>
          <p className="mb-3 text-xs text-ink-3">The more of this you fill in, the better every post fits. Ten minutes reading the About section, the rules, and the admin&apos;s last five posts is enough.</p>
          <form action={updateGroupAction} className="space-y-3">
            <input type="hidden" name="id" value={g.id} />
            <Field label="Name">
              <input className="field" name="name" defaultValue={g.name} required />
            </Field>
            <Field label="URL">
              <input className="field" name="url" type="url" defaultValue={g.url ?? ""} />
            </Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="List">
                <select className="field" name="kind" defaultValue={g.kind}>
                  <option value="own">My group</option>
                  <option value="member">Member</option>
                  <option value="prospect">Prospect</option>
                </select>
              </Field>
              <Field label="Slot (1–3)">
                <input className="field" name="rank" type="number" min={0} max={3} defaultValue={g.rank} />
              </Field>
              <Field label="Members">
                <input className="field" name="memberCount" type="number" min={0} defaultValue={g.memberCount ?? ""} />
              </Field>
              <Field label="Posts / day">
                <input className="field" name="postsPerDay" type="number" min={0} defaultValue={g.postsPerDay ?? ""} />
              </Field>
            </div>
            <Field label="Mission" hint="Usually the first lines of the About section.">
              <textarea className="field" name="mission" defaultValue={g.mission ?? ""} />
            </Field>
            <Field label="Description">
              <textarea className="field" name="description" defaultValue={g.description ?? ""} />
            </Field>
            <Field label="Who's in here">
              <input className="field" name="audience" defaultValue={g.audience ?? ""} placeholder="Coaches doing $2k–$10k months who post but don't sell." />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Admin name">
                <input className="field" name="adminName" defaultValue={g.adminName ?? ""} />
              </Field>
              <Field label="Your rating (1–5)">
                <input className="field" name="rating" type="number" min={0} max={5} defaultValue={g.rating ?? ""} />
              </Field>
            </div>
            <Field label="What the admin values" hint="What they praise in comments, what they post themselves, what gets deleted.">
              <textarea className="field" name="adminValues" defaultValue={g.adminValues ?? ""} />
            </Field>
            <Field label="Rules">
              <textarea className="field" name="rules" defaultValue={g.rules ?? ""} />
            </Field>
            <Field label="Posting norms" hint="Best days, promo day if any, format, length.">
              <textarea className="field" name="postingNorms" defaultValue={g.postingNorms ?? ""} />
            </Field>
            <Field label="What works here" hint="The two post types that get the most comments.">
              <textarea className="field" name="whatWorks" defaultValue={g.whatWorks ?? ""} />
            </Field>
            <Field label="Notes">
              <textarea className="field" name="notes" defaultValue={g.notes ?? ""} />
            </Field>
            <button className="btn btn-primary" type="submit">Save</button>
          </form>
          <form action={deleteGroupAction} className="mt-3">
            <input type="hidden" name="id" value={g.id} />
            <button className="text-xs text-danger underline" type="submit">Remove this group</button>
          </form>
        </Card>
        <div className="space-y-4">
          <Card title="What the rules say">
            <ul className="space-y-1 text-sm">
              <li>{rules.noLinks ? "🚫 No links. Drafts strip them automatically." : "🔗 Links not forbidden. Still lead with value."}</li>
              <li>{rules.noPromo ? "🚫 No pitching. Drafts drop the CTA." : "🤝 Soft CTA allowed when the post earns it."}</li>
              <li>{rules.noDm ? "🚫 No cold DMs. Let them come to you." : "💬 DMs okay after a real exchange in comments."}</li>
              {rules.askFirst ? <li>✋ Admin approval required before posting.</li> : null}
              {rules.promoDay ? <li>📅 Promo window: {rules.promoDay}</li> : null}
            </ul>
          </Card>
          {preview ? (
            <Card title="How a post gets shaped here" action={<span className="text-xs text-ink-3">using “{sample?.title}”</span>}>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-sans text-sm">{preview.body}</pre>
              <ul className="mt-3 space-y-1 text-xs">
                {preview.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    <span>{c.ok ? "✅" : "⚠️"}</span>
                    <span><span className="font-medium">{c.label}.</span> <span className="text-ink-3">{c.note}</span></span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-3">Generate the real draft from any post&apos;s Repurpose page.</p>
            </Card>
          ) : null}
          <Card title="Posted here">
            {variants.length ? (
              <ul className="divide-y text-sm">
                {variants.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`/content/${x.contentItemId}/repurpose`} className="min-w-0 truncate hover:underline">{titleOf.get(x.contentItemId) ?? "Post"}</Link>
                    <span className="shrink-0 text-xs text-ink-3">{x.status}{x.postedAt ? ` · ${formatDate(x.postedAt.slice(0, 10))}` : ""}{x.status === "posted" ? ` · 💬 ${x.comments} · 📨 ${x.dms}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">Nothing shaped for this group yet.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
