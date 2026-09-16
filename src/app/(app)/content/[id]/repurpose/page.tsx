import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { generateVariantsAction, updateVariantAction } from "@/lib/actions/variants";
import { generateGroupVariantsAction } from "@/lib/actions/groups";
import { distributeAllAction } from "@/lib/actions/compose";
import { ILLUSTRATIVE_LABEL, ILLUSTRATIVE_MARK, PRIVATE_URL_REFUSAL } from "@/lib/engine/compose-media";
import { checkAllPostStatusAction, syncPostStatusAction } from "@/lib/actions/social";
import { nowFor, outcomeOf, outcomesFor, type ChannelOutcome } from "@/lib/engine/channel-outcome";
import { refreshStale } from "@/lib/planner-status";
import { handoffRow } from "@/lib/queries/outcomes";
import { handOffLadderAction } from "@/lib/actions/drip";
import { THREADS_EXCLUSIVE } from "@/lib/engine/rung-drip";
import { OutcomeHeadline, OutcomeRows } from "@/components/channel-outcome";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { CHANNEL_SPECS } from "@/lib/engine/repurpose";
import { alignPost, groupReadiness, groupSpec } from "@/lib/engine/groups";
import type { ContentVariant, Group } from "@/db/schema";
import { AiFormStatus } from "@/components/ai-status";
import { AiPromise } from "@/components/ai-promise";

function VariantForm({ var_, maxChars, email = false, outcome }: { var_: ContentVariant; maxChars: number; email?: boolean; outcome?: ChannelOutcome }) {
  return (
    <form action={updateVariantAction} className="space-y-2">
      <input type="hidden" name="id" value={var_.id} />
      {email ? (
        <Field label="Subject">
          <input className="field" name="subject" defaultValue={var_.subject ?? ""} />
        </Field>
      ) : null}
      {var_.notes ? (
        <p className="whitespace-pre-line rounded-lg border border-danger bg-danger-soft p-2 text-xs" data-testid="variant-notes" role="alert">
          {var_.notes}
        </p>
      ) : null}
      <textarea className="field min-h-40 text-sm" name="body" defaultValue={var_.body} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-3 tabular">
          {var_.body.length}/{maxChars}
        </span>
        <CopyButton text={email && var_.subject ? `Subject: ${var_.subject}\n\n${var_.body}` : var_.body} label="Copy" className="btn btn-ghost btn-xs" />
        <select className="field w-auto py-1 text-xs" name="status" defaultValue={var_.status}>
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="posted">Posted</option>
          <option value="skipped">Skip</option>
        </select>
        <input className="field w-40 py-1 text-xs" name="postUrl" placeholder="Post URL" defaultValue={var_.postUrl ?? ""} />
        <button className="btn btn-primary btn-xs" type="submit">
          Save
        </button>
      </div>
      {outcome ? <OutcomeRows outcomes={[outcome]} checkAction={syncPostStatusAction} compact inForm /> : null}
      {var_.status === "posted" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["reactions", "comments", "dms", "leads"] as const).map((k) => (
            <label key={k} className="block">
              <span className="label">{k}</span>
              <input className="field tabular py-1 text-xs" name={k} type="number" min={0} defaultValue={var_[k]} />
            </label>
          ))}
        </div>
      ) : null}
    </form>
  );
}

function StatusBadge({ v }: { v?: ContentVariant }) {
  return v ? <Badge tone={v.status === "posted" ? "good" : v.status === "scheduled" ? "accent" : "neutral"}>{v.status}</Badge> : <span className="text-xs text-ink-3">not generated</span>;
}

function GroupCard({ g, var_, src, slot, outcome }: { g: Group; var_?: ContentVariant; src: { title: string; hook: string | null; body: string | null; hasCta: boolean; ctaText: string | null }; slot?: string; outcome?: ChannelOutcome }) {
  const aligned = alignPost(src, g);
  const ready = groupReadiness(g);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {slot ? <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px] text-white">{slot}</span> : null}
          <Link href={`/groups/${g.id}`} className="hover:underline">{g.name}</Link>
        </span>
      }
      action={<StatusBadge v={var_} />}
    >
      <p className="mb-2 text-xs text-ink-3">
        {g.adminName ? `Admin ${g.adminName}. ` : ""}
        {g.mission ? `Mission: ${g.mission.split(/[.\n]/)[0]}.` : `Profile ${ready}% complete. Add the mission and rules so the draft can honor them.`}
      </p>
      {var_ ? <VariantForm var_={var_} maxChars={groupSpec(g.kind).maxChars} outcome={outcome} /> : <p className="text-sm text-ink-3">Tick this group above and generate.</p>}
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {aligned.checks.map((c) => (
          <li key={c.key} title={c.note} className={c.ok ? "text-good" : "text-warn"}>
            {c.ok ? "✓" : "!"} {c.label}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default async function RepurposePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ blocked?: string; drip?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const { blocked, drip } = await searchParams;
  // The page's own sentences, chosen by a code: a block on the one-click send is never silent and never free text from the address bar.
  const blockedLine = blocked === "threads" ? THREADS_EXCLUSIVE : blocked === "media" ? `${ILLUSTRATIVE_LABEL}\nAn attached file shows a result. Add ${ILLUSTRATIVE_MARK} to the post, in every version that goes out. Nothing was scheduled.` : blocked === "url" ? `${PRIVATE_URL_REFUSAL} Nothing was scheduled.` : blocked === "fabricated" ? "A statistic in this post is on the blacklist, so nothing was scheduled. Open it in the composer to see which one and what to say instead." : null;
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, v.user.id)) });
  if (!item) notFound();
  const [variants, groups] = await Promise.all([
    db.query.contentVariants.findMany({ where: eq(schema.contentVariants.contentItemId, id) }),
    db.query.groups.findMany({ where: eq(schema.groups.userId, v.user.id), orderBy: [asc(schema.groups.kind), asc(schema.groups.rank)] }),
  ]);
  const src = { title: item.title, hook: item.hook, body: item.body, hasCta: item.hasCta, ctaText: item.cta };
  // One rule for every version's outcome, read once for the page: the same one the card and the composer read.
  const now = nowFor(v);
  // Rows due a readback (an accepted one with no id, or any not read back for an hour) are checked as the page opens.
  const fresh = await refreshStale(v.user.id, variants);
  const freshById = new Map(fresh.map((x) => [x.id, x]));
  const outcomeFor = (x: ContentVariant) => (x.status === "draft" || x.status === "skipped" ? undefined : outcomeOf(freshById.get(x.id) ?? x, now));
  const handoff = await handoffRow(v, item, fresh, now);
  const outcomes = outcomesFor(fresh, now, [handoff.row]);
  const canCheck = outcomes.some((o) => o.canCheck);
  const canHandOff = Boolean(handoff.ladder) && !handoff.reasons.length && handoff.row?.state !== "handed";
  const own = groups.filter((g) => g.kind === "own");
  const top3 = groups.filter((g) => g.kind === "prospect" && g.rank >= 1 && g.rank <= 3).sort((a, b) => a.rank - b.rank);
  const others = groups.filter((g) => g.kind === "member" || (g.kind === "prospect" && !top3.includes(g)));
  const outcomeOfGroup = (g: Group) => { const x = forGroup(g); return x ? outcomeFor(x) : undefined; };
  const forGroup = (g: Group) => variants.find((x) => x.groupId === g.id);
  const generic = (key: string) => variants.find((x) => x.channel === key && x.groupId === "");
  const everywhere = CHANNEL_SPECS.filter((c) => !(own.length && c.key === "fb_group") && !(top3.length && c.key === "other_groups"));
  const posted = variants.filter((x) => x.status === "posted").length;
  const reach = variants.reduce((a, x) => ({ reactions: a.reactions + x.reactions, comments: a.comments + x.comments, dms: a.dms + x.dms, leads: a.leads + x.leads }), { reactions: 0, comments: 0, dms: 0, leads: 0 });
  const ai = await hasAiKey();

  return (
    <>
      <PageHeader
        title={`Distribute: ${item.title}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/content/${item.id}`} className="hover:underline">
              ← Back to the post
            </Link>
            <span>
              {posted} posted · 👍 {reach.reactions} · 💬 {reach.comments} · 📨 {reach.dms} DMs · 🆕 {reach.leads} leads
            </span>
            {outcomes.length ? <OutcomeHeadline outcomes={outcomes} /> : null}
          </span>
        }
        action={
          // A form is not valid inside the subtitle's paragraph (the browser re-nests it and React re-renders the tree), so it lives in the header's action slot.
          canCheck ? (
            <form action={checkAllPostStatusAction}>
              <input type="hidden" name="contentId" value={item.id} />
              <button className="btn btn-ghost btn-xs" type="submit">Check every version with GoHighLevel</button>
            </form>
          ) : undefined
        }
      />

      {drip ? (
        <p className="mb-4 rounded-lg border border-warn bg-warn-soft p-3 text-sm" data-testid="drip-refused" role="alert">{drip}</p>
      ) : null}
      {handoff.row ? (
        <Card className="mb-4" title="💬 Comment ladder" action={<span className="text-xs text-ink-3">Community Loyalty posts the rungs</span>}>
          <OutcomeRows outcomes={[handoff.row]} />
          {canHandOff ? (
            <form action={handOffLadderAction} className="mt-3 flex flex-wrap items-end gap-2" data-testid="handoff-form">
              <input type="hidden" name="contentId" value={item.id} />
              <Field label="Threads time (optional, at least 15 minutes out; blank asks Community Loyalty for it now)">
                <input className="field" name="threadsAt" type="datetime-local" />
              </Field>
              <button className="btn btn-primary btn-sm" type="submit">Send comments to Community Loyalty</button>
            </form>
          ) : null}
        </Card>
      ) : null}
      {blockedLine ? (
        <p className="mb-4 whitespace-pre-line rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="distribute-blocked" role="alert">{blockedLine}</p>
      ) : null}
      <Card className="mb-4" title="One click: everywhere" action={<Link href={`/content/${item.id}/compose`} className="text-xs underline">Open in composer</Link>}>
        <form action={distributeAllAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="contentItemId" value={item.id} />
          <p className="w-full text-sm text-ink-2">Drafts every channel plus your group and top 3 prospecting groups, then schedules them 45 minutes apart in the order that builds momentum: your group first, profile and Instagram next, long-form last. Channels publish through the Social Planner when GoHighLevel is connected; group posts wait for you to paste.</p>
          <label className="block">
            <span className="label">Start date</span>
            <input className="field" name="startDate" type="date" defaultValue={v.today} />
          </label>
          <label className="block">
            <span className="label">Time</span>
            <input className="field" name="startTime" type="time" defaultValue="09:00" />
          </label>
          <button className="btn btn-accent" type="submit">🚀 Schedule everywhere</button>
        </form>
      </Card>

      {/* Groups first: this is where the conversations start */}
      <Card title="Groups" action={<Link href="/groups" className="text-xs underline">Manage groups</Link>}>
        {groups.length ? (
          <form action={generateGroupVariantsAction} className="space-y-3">
            <input type="hidden" name="contentItemId" value={item.id} />
            <p className="text-sm text-ink-2">One draft per group, shaped to that group&apos;s mission, the admin&apos;s values and the rules. Your own group gets the full CTA. Other people&apos;s groups get value first and no links.</p>
            <div className="flex flex-wrap gap-2">
              {[...own, ...top3, ...others].map((g) => (
                <label key={g.id} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                  <input type="checkbox" name="groupIds" value={g.id} defaultChecked={g.kind === "own" || top3.includes(g)} />
                  {g.kind === "own" ? "🏠" : top3.includes(g) ? `🎯${g.rank}` : "👥"} {g.name}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-accent" type="submit">Generate group drafts</button>
              {ai ? <button className="btn btn-soft" type="submit" name="ai" value="1">✨ With AI</button> : null}
            </div>
            <AiFormStatus feature="group_variant" enabled={ai} onlyWhen={{ field: "ai", value: "1" }} />
            <AiPromise enabled={ai}>With AI returns one draft per group you tick, shaped to that group&apos;s mission and rules: your own group keeps the call to action, other people&apos;s groups get value first and no links.</AiPromise>
          </form>
        ) : (
          <p className="text-sm text-ink-2">
            Add your group and your top 3 prospecting groups on the <Link href="/groups" className="underline">Groups</Link> page and every post gets a draft shaped for each one.
          </p>
        )}
      </Card>

      {own.length ? (
        <>
          <h2 className="mt-5 mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">🏠 My group</h2>
          <div className="grid gap-3 lg:grid-cols-2">{own.map((g) => <GroupCard key={g.id} g={g} var_={forGroup(g)} src={src} outcome={outcomeOfGroup(g)} />)}</div>
        </>
      ) : null}
      {top3.length ? (
        <>
          <h2 className="mt-5 mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">🎯 Top 3 to prospect in</h2>
          <div className="grid gap-3 lg:grid-cols-3">{top3.map((g) => <GroupCard key={g.id} g={g} var_={forGroup(g)} src={src} slot={String(g.rank)} outcome={outcomeOfGroup(g)} />)}</div>
        </>
      ) : null}
      {others.some((g) => forGroup(g)) ? (
        <>
          <h2 className="mt-5 mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">👥 Other groups</h2>
          <div className="grid gap-3 lg:grid-cols-3">{others.filter((g) => forGroup(g)).map((g) => <GroupCard key={g.id} g={g} var_={forGroup(g)} src={src} outcome={outcomeOfGroup(g)} />)}</div>
        </>
      ) : null}

      <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">🌐 Everywhere else</h2>
      <Card>
        <form action={generateVariantsAction} className="space-y-3">
          <input type="hidden" name="contentItemId" value={item.id} />
          <p className="text-sm text-ink-2">Profile, page, stories, Instagram, Threads, LinkedIn, email, Skool. Each draft is shaped to how that channel is read. Posted channels are never overwritten.</p>
          <div className="flex flex-wrap gap-2">
            {everywhere.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="checkbox" name="channels" value={c.key} defaultChecked />
                {c.icon} {c.label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-accent" type="submit">Generate drafts</button>
            {ai ? <button className="btn btn-soft" type="submit" name="ai" value="1">✨ With AI</button> : <span className="text-xs text-ink-3"><Link href="/settings#ai" className="underline">Connect your AI key in Settings</Link> to have each draft polished in your voice.</span>}
          </div>
          <AiFormStatus feature="repurpose" enabled={ai} onlyWhen={{ field: "ai", value: "1" }} />
          <AiPromise enabled={ai}>With AI returns one draft per channel you tick, rewritten for that format inside its length and link rules.</AiPromise>
        </form>
      </Card>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {everywhere.map((c) => {
          const var_ = generic(c.key);
          return (
            <Card key={c.key} title={`${c.icon} ${c.label}`} action={<StatusBadge v={var_} />}>
              <p className="mb-2 text-xs text-ink-3">{c.why}</p>
              {var_ ? <VariantForm var_={var_} maxChars={c.maxChars} email={c.key === "email"} outcome={outcomeFor(var_)} /> : <p className="text-sm text-ink-3">Generate drafts above.</p>}
            </Card>
          );
        })}
      </div>
    </>
  );
}
