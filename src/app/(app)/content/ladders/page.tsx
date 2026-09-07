import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { createLadderAction, deleteLadderAction } from "@/lib/actions/ladders";
import { Badge, Card, Disclosure, Empty, Field, PageHeader, Tabs } from "@/components/ui";
import { LADDER_FORMATS, cadenceNotes, checkScore, checklist } from "@/lib/engine/ladder";
import { addDays, formatDate, formatDateTime, weekday } from "@/lib/dates";
import { AiFormStatus } from "@/components/ai-status";
import { AiPromise } from "@/components/ai-promise";

export const metadata = { title: "Ladders" };

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "good" | "warn" }> = {
  draft: { label: "Draft", tone: "neutral" },
  ready: { label: "Ready", tone: "good" },
  live: { label: "Live now", tone: "accent" },
  done: { label: "Posted", tone: "neutral" },
};

function nextSlot(today: string): string {
  let d = addDays(today, 1);
  for (let i = 0; i < 7; i++, d = addDays(d, 1)) if (weekday(d) >= 2 && weekday(d) <= 4) return d;
  return d;
}

export default async function LaddersPage() {
  const v = await requireViewer();
  const [list, profile, proofs] = await Promise.all([
    db.query.ladders.findMany({ where: eq(schema.ladders.userId, v.user.id), orderBy: desc(schema.ladders.createdAt) }),
    db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, v.workspace.id), eq(schema.ladderProfiles.userId, v.user.id)) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, v.workspace.id), eq(schema.proofs.userId, v.user.id), eq(schema.proofs.status, "approved")) }),
  ]);
  const ai = await hasAiKey();
  const keywords = profile?.keywords.filter((k) => k.keyword) ?? [];
  const lastLaunch = list.map((l) => l.launchedAt).filter(Boolean).sort().at(-1) ?? null;
  const slot = nextSlot(v.today);
  const cadence = cadenceNotes(`${slot}T09:00:00`, v.tz, lastLaunch);
  const tabs = [
    { key: "board", label: "Board", href: "/content" },
    { key: "calendar", label: "Calendar", href: "/content?view=calendar" },
    { key: "posted", label: "Posted", href: "/content?view=posted" },
    { key: "ladders", label: "Ladders", href: "/content/ladders", count: list.filter((l) => l.status !== "done").length },
  ];
  return (
    <>
      <PageHeader
        title="Comment ladders"
        subtitle="One sparse post. Nine to eleven comments you post yourself over the first hour. The whole plan is in the comments."
        action={<Link href="/content/ladders/profile" className={`btn btn-sm ${profile?.productName ? "btn-ghost" : "btn-accent"}`}>{profile?.productName ? "Your facts" : "Set up your facts first"}</Link>}
      />
      <Tabs items={tabs} current="ladders" />
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <Card title="New ladder">
            {!profile?.productName ? <p className="mb-3 rounded-lg bg-warn-soft p-2 text-xs">Ladders are written from your facts: product, price, keyword, what you may claim. <Link href="/content/ladders/profile" className="underline">Fill them in once</Link> and every ladder uses them.</p> : null}
            {!proofs.length ? <p className="mb-3 rounded-lg bg-surface-2 p-2 text-xs text-ink-2">No approved proof yet. Ladders will carry a [PROOF PLACEHOLDER] until you approve one in the <Link href="/proof" className="underline">Proof Bank</Link>. Testimonials are never invented.</p> : null}
            <form action={createLadderAction} className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Format">
                  <select className="field" name="format" defaultValue="method_resource">
                    {LADDER_FORMATS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.name} — {f.oneLiner}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Topic" hint="What the post is about, in one line.">
                  <input className="field" name="topic" required placeholder="How I lost 15 lbs without giving up wine" />
                </Field>
              </div>
              <Field label="Audience">
                <select className="field" name="audience" defaultValue="warm">
                  <option value="warm">Warm: people who already follow me</option>
                  <option value="cold">Cold: business owners who don&apos;t know me</option>
                </select>
              </Field>
              <Field label="Keyword" hint="Goes in the final rung only. NONE for pure story posts.">
                <select className="field" name="keyword" defaultValue={keywords[0]?.keyword ?? "NONE"}>
                  {keywords.map((k) => (
                    <option key={k.keyword} value={k.keyword}>
                      {k.keyword} — {k.use}
                    </option>
                  ))}
                  <option value="NONE">NONE — close with a question</option>
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Source material (optional)" hint="A transcript, notes, a quote with its source. The model may only use what's here and in your facts.">
                  <textarea className="field" name="sourceMaterial" rows={3} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Real numbers (optional)" hint="Figures that must be used exactly. Anything else is marked illustrative. Required for a Numbers Teardown.">
                  <textarea className="field" name="realNumbers" rows={2} placeholder="Last month: 100 leads, 12 calls, 4 clients at $497" />
                </Field>
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <button className="btn btn-primary" type="submit">
                  {ai ? "Write the ladder" : "Build the skeleton"}
                </button>
                <AiFormStatus feature="ladder" enabled={ai} />
                {ai ? (
                  <AiPromise enabled>Returns a full post, 9–11 comment rungs, a headline with alternates, a carousel, an Instagram caption and a Threads chain, written from your product facts. Testimonials come only from approved proof; otherwise it carries a [PROOF PLACEHOLDER].</AiPromise>
                ) : (
                  <>
                    <p className="text-xs text-ink-3">Builds the skeleton: the body, rung slots and headline with the blanks marked for you to fill.</p>
                    <AiPromise enabled={false}>{null}</AiPromise>
                  </>
                )}
                <span className="text-xs text-ink-3">{ai ? "AI drafts every field from your facts and approved proof, on your own key. You edit, the checklist keeps it honest." : <>No AI key connected, so you get the full structure with every blank marked. <Link href="/settings#ai" className="underline">Connect your AI key in Settings</Link> to have it drafted for you.</>}</span>
              </div>
            </form>
          </Card>
          <Card title="Your ladders">
            {list.length ? (
              <ul className="divide-y">
                {list.map((l) => {
                  const score = checkScore(checklist(l, profile ?? null, proofs));
                  const st = STATUS[l.status];
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <Link href={`/content/ladders/${l.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                        {l.postName || l.topic}
                      </Link>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <span className="text-xs text-ink-3">{LADDER_FORMATS.find((f) => f.key === l.format)?.name} · {l.rungs.length} rungs · {score.fails ? `${score.fails} to fix` : "checklist clear"}</span>
                      {l.launchedAt ? <span className="text-xs text-ink-3">· {formatDateTime(l.launchedAt, v.workspace.timezone)}</span> : null}
                      <form action={deleteLadderAction}>
                        <input type="hidden" name="id" value={l.id} />
                        <button className="text-xs text-ink-3 underline" type="submit">Delete</button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty icon="🪜" title="No ladders yet" hint="Pick a format, give it a topic, and the whole package comes back: body, rungs, headline, carousel, caption, Threads chain." />
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Cadence">
            <p className="text-sm text-ink-2">Two ladders a week at most, 72 hours apart, Tuesday to Thursday mornings. Launch on your personal profile, re-post natively on your page a day or two later, then your group.</p>
            <p className="mt-2 text-sm">Next good slot: <b>{formatDate(slot, { weekday: "short", month: "short", day: "numeric" })}, 9:00am</b></p>
            <ul className="mt-2 space-y-1 text-xs">
              {cadence.map((c, i) => (
                <li key={i} className={c.ok ? "text-ink-2" : "text-warn"}>
                  {c.ok ? "✓" : "!"} {c.note}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-3">Between ladders: 3–4 lighter posts. All rungs go up inside the first hour.</p>
          </Card>
          <Card title="The 13 formats">
            <ul className="space-y-1 text-xs">
              {LADDER_FORMATS.map((f) => (
                <li key={f.key}>
                  <b>{f.name}.</b> <span className="text-ink-2">{f.oneLiner}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Disclosure summary={<span className="text-xs text-ink-3 underline">Why the body never says &quot;comment KEYWORD&quot;</span>}>
            <p className="mt-2 text-xs text-ink-2">Meta classifies comment-keyword prompts as engagement bait and demotes them. An open question is exempt and earns better reach. The keyword belongs in the final rung, where it reads as fulfilment for someone who already read the whole thread. On a personal profile comment automation can&apos;t fire, so the final rung also says &quot;If nothing happens, message me KEYWORD.&quot;</p>
          </Disclosure>
        </div>
      </div>
    </>
  );
}
