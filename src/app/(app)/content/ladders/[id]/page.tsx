import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { markRungAction, regenerateLadderAction, sendLadderToComposerAction, setLadderStatusAction, updateLadderAction } from "@/lib/actions/ladders";
import { CopyButton } from "@/components/copy-button";
import { LiveClock } from "@/components/rung-runner";
import { Badge, Card, Disclosure, Field, PageHeader } from "@/components/ui";
import { checkScore, checklist, formatFor, headlineParts, readyToPost, rungGapMinutes, rungsForAirtable, rungsPlain, threadsText } from "@/lib/engine/ladder";
import { AiFormStatus } from "@/components/ai-status";

function HeadlinePreview({ headline, handle }: { headline: string; handle?: string | null }) {
  const h = headlineParts(headline);
  const gold = h.gold[0]?.toUpperCase() ?? "";
  const paint = (line: string) => {
    const up = line.toUpperCase();
    const at = gold ? up.indexOf(gold) : -1;
    if (at < 0) return <>{up}</>;
    return (
      <>
        {up.slice(0, at)}
        <span style={{ color: "#DDA338" }}>{up.slice(at, at + gold.length)}</span>
        {up.slice(at + gold.length)}
      </>
    );
  };
  return (
    <div className="rounded-lg p-4 text-white" style={{ background: "linear-gradient(180deg, #3a3a3a 0%, #0D0D0D 70%)", fontFamily: "Anton, Impact, 'Arial Narrow', sans-serif", letterSpacing: "0.01em" }} data-testid="headline-preview">
      <div className="text-2xl leading-tight sm:text-3xl">
        {h.lines.map((l, i) => (
          <div key={i}>{paint(l)}</div>
        ))}
      </div>
      <div className="mt-3 text-xs" style={{ color: "#DDA338" }}>(READ COMMENTS 👇)</div>
      {handle ? <div className="mt-1 text-[10px] text-white/70">{handle}</div> : null}
    </div>
  );
}

export default async function LadderPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const l = await db.query.ladders.findFirst({ where: and(eq(schema.ladders.id, id), eq(schema.ladders.userId, v.user.id)) });
  if (!l) notFound();
  const [profile, proofs] = await Promise.all([
    db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, v.workspace.id), eq(schema.ladderProfiles.userId, v.user.id)) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, v.user.id), eq(schema.proofs.status, "approved")) }),
  ]);
  const ai = await hasAiKey();
  const fmt = formatFor(l.format);
  const checks = checklist(l, profile ?? null, proofs);
  const score = checkScore(checks);
  const ready = readyToPost(checks);
  const airtable = rungsForAirtable(l.rungs);
  return (
    <>
      <PageHeader
        title={l.postName || l.topic}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/content/ladders" className="hover:underline">← Ladders</Link>
            <Badge tone={l.status === "ready" ? "good" : l.status === "live" ? "accent" : "neutral"}>{l.status}</Badge>
            <span>{fmt.name} · {l.audience} audience · keyword {l.keyword} · {l.generatedBy === "claude" ? "drafted by AI" : l.generatedBy === "scaffold" ? "skeleton, fill the blanks" : l.generatedBy}</span>
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <form action={sendLadderToComposerAction}>
              <input type="hidden" name="id" value={l.id} />
              <button className="btn btn-primary btn-sm" type="submit">{l.contentItemId ? "Open in composer" : "Send to composer"}</button>
            </form>
            <form action={setLadderStatusAction}>
              <input type="hidden" name="id" value={l.id} />
              <input type="hidden" name="status" value={l.status === "draft" ? "ready" : "draft"} />
              <button className="btn btn-ghost btn-sm" type="submit" disabled={l.status === "draft" && !ready} title={l.status === "draft" && !ready ? "Clear the checklist first" : ""}>
                {l.status === "draft" ? "Mark ready" : "Back to draft"}
              </button>
            </form>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <form action={updateLadderAction} className="space-y-4">
            <input type="hidden" name="id" value={l.id} />
            <Card title="Post body" action={<CopyButton text={l.copy} label="Copy body" className="btn btn-ghost btn-xs" />}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Post name">
                  <input className="field" name="postName" defaultValue={l.postName} />
                </Field>
                <Field label="Keyword (final rung only)">
                  <input className="field" name="dmKeyword" defaultValue={l.dmKeyword} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Hook" hint="One sentence. The first line.">
                    <input className="field" name="hook" defaultValue={l.hook} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Body" hint="Hook lines, 'read them in order', a save line, ONE open question. Never 'comment KEYWORD'.">
                    <textarea className="field font-mono text-sm" name="copy" rows={8} defaultValue={l.copy} />
                  </Field>
                </div>
              </div>
            </Card>
            <Card title={`Rungs (${l.rungs.length})`} action={<span className="flex gap-2"><CopyButton text={rungsPlain(l.rungs)} label="Copy all" className="btn btn-ghost btn-xs" /><CopyButton text={airtable} label="Copy for Airtable" className="btn btn-ghost btn-xs" /></span>}>
              <p className="mb-2 text-xs text-ink-2">{fmt.structure} 40–90 words each, one thought per line, and the last line of every rung is the quotable one. Keep <code>---</code> between rungs. &quot;Copy for Airtable&quot; escapes the numbers as <code>1\.</code> so Airtable doesn&apos;t renumber them.</p>
              <textarea className="field font-mono text-sm" name="rungs" rows={Math.min(40, 6 + l.rungs.length * 5)} defaultValue={rungsPlain(l.rungs)} data-testid="rungs" />
            </Card>
            <Card title="Headline and graphic">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-3">
                  <Field label="Headline" hint='8–14 words, two lines split with " / ", one (gold: PHRASE).'>
                    <input className="field" name="headline" defaultValue={l.headline} />
                  </Field>
                  <Field label="Alternatives" hint="One per line.">
                    <textarea className="field" name="altHeadlines" rows={2} defaultValue={l.altHeadlines.join("\n")} />
                  </Field>
                </div>
                <div>
                  <HeadlinePreview headline={l.headline} handle={profile?.handle} />
                  <p className="mt-2 text-[11px] text-ink-3">1080 × 1350. Photo top 60%, gradient to near-black. Anton, all caps, white, one gold phrase (#DDA338). The photo must argue the headline. Generate backgrounds only; you type the words.</p>
                </div>
              </div>
            </Card>
            <Card title="Instagram and Threads">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Carousel (9 slides, one per line)">
                    <textarea className="field font-mono text-xs" name="carousel" rows={9} defaultValue={l.carousel.join("\n")} />
                  </Field>
                </div>
                <Field label={`Instagram caption (${l.igCaption.length}/2,200)`}>
                  <textarea className="field text-sm" name="igCaption" rows={12} defaultValue={l.igCaption} />
                </Field>
                <Field label={`Threads chain (${l.threadsChain.length} posts, --- between, 500 each)`}>
                  <textarea className="field text-sm" name="threadsChain" rows={12} defaultValue={l.threadsChain.join("\n---\n")} />
                </Field>
                <div className="flex gap-2 sm:col-span-2">
                  <CopyButton text={l.igCaption} label="Copy caption" className="btn btn-ghost btn-xs" />
                  <CopyButton text={threadsText(l.threadsChain)} label="Copy Threads chain" className="btn btn-ghost btn-xs" />
                  <CopyButton text={l.carousel.join("\n")} label="Copy slides" className="btn btn-ghost btn-xs" />
                </div>
              </div>
            </Card>
            <Card title="Notes and real numbers">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Real numbers used" hint="Figures that are true. Everything else must be marked illustrative.">
                  <textarea className="field text-sm" name="realNumbers" rows={4} defaultValue={l.realNumbers ?? ""} />
                </Field>
                <Field label="Notes" hint="What to verify before it goes live.">
                  <textarea className="field text-sm" name="notes" rows={4} defaultValue={l.notes ?? ""} />
                </Field>
              </div>
              <button className="btn btn-primary mt-3" type="submit">
                Save and re-check
              </button>
            </Card>
          </form>
        </div>
        <div className="space-y-4">
          <Card title="Pre-publish checklist" action={<Badge tone={ready ? "good" : "warn"}>{ready ? "clear" : `${score.fails} to fix`}</Badge>}>
            <ul className="space-y-1 text-xs" data-testid="checklist">
              {checks.map((c) => (
                <li key={c.key} className={c.ok ? "text-ink-2" : c.level === "fail" ? "text-danger" : "text-warn"} data-check={c.key} data-ok={c.ok ? "1" : "0"}>
                  {c.ok ? "✓" : c.level === "fail" ? "✗" : "!"} {c.label}
                  {!c.ok && c.note ? <span className="block pl-4 text-ink-3">{c.note}</span> : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-3">{score.pass}/{score.total} passing. Warnings don&apos;t block; failures do. Things no checker can see: every stat cited plainly, no contempt, the photo argues the headline.</p>
          </Card>
          <Card title="Live posting hour">
            <p className="mb-2 text-xs text-ink-2">Post the body. Then copy each rung and post it as your own comment, one every {rungGapMinutes(l.rungs.length)} minutes. Tick them as they go up.</p>
            {(() => {
              const posted = l.rungs.filter((r) => r.postedAt);
              const next = l.rungs.find((r) => !r.postedAt) ?? null;
              const gap = rungGapMinutes(l.rungs.length);
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <LiveClock postedCount={posted.length} total={l.rungs.length} lastPostedAt={posted.map((r) => r.postedAt!).sort().at(-1) ?? null} launchedAt={l.launchedAt} gapMinutes={gap} nextN={next?.n ?? null} />
                    <form action={markRungAction} className="ml-auto">
                      <input type="hidden" name="id" value={l.id} />
                      <input type="hidden" name="clearAll" value="1" />
                      <button className="text-xs text-ink-3 underline" type="submit">Reset</button>
                    </form>
                  </div>
                  <ol className="divide-y rounded-lg border">
                    {l.rungs.map((r) => (
                      <li key={r.n} className={`flex items-start gap-2 p-2 text-sm ${r.postedAt ? "opacity-60" : next?.n === r.n ? "bg-surface-2" : ""}`} data-testid={`rung-${r.n}`}>
                        <span className="w-6 shrink-0 text-right font-semibold tabular">{r.n}.</span>
                        <span className="min-w-0 flex-1 truncate">{r.body.split("\n")[0]}</span>
                        <CopyButton text={r.body} label="Copy" className="btn btn-ghost btn-xs" />
                        <form action={markRungAction}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="n" value={r.n} />
                          <button className={`btn btn-xs ${r.postedAt ? "btn-ghost" : next?.n === r.n ? "btn-primary" : "btn-soft"}`} type="submit">
                            {r.postedAt ? "Undo" : "Posted ✓"}
                          </button>
                        </form>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })()}
          </Card>
          <Card title="Brief">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-ink-3">Format</dt>
              <dd>{fmt.name}. {fmt.oneLiner}</dd>
              <dt className="text-ink-3">Topic</dt>
              <dd>{l.topic}</dd>
              <dt className="text-ink-3">Audience</dt>
              <dd>{l.audience}</dd>
              {l.sourceMaterial ? (
                <>
                  <dt className="text-ink-3">Source</dt>
                  <dd className="whitespace-pre-wrap">{l.sourceMaterial}</dd>
                </>
              ) : null}
            </dl>
            {fmt.stopRule ? <p className="mt-2 rounded-lg bg-warn-soft p-2 text-xs">Stop rule: {fmt.stopRule}</p> : null}
            <Disclosure summary={<span className="mt-3 inline-block text-xs underline">{ai ? "Edit the brief and regenerate" : "Regenerate the skeleton"}</span>}>
              <form action={regenerateLadderAction} className="mt-2 space-y-2">
                <input type="hidden" name="id" value={l.id} />
                <Field label="Topic">
                  <input className="field" name="topic" defaultValue={l.topic} />
                </Field>
                <Field label="Source material">
                  <textarea className="field text-sm" name="sourceMaterial" rows={3} defaultValue={l.sourceMaterial ?? ""} />
                </Field>
                <Field label="Real numbers">
                  <textarea className="field text-sm" name="realNumbers" rows={2} defaultValue={l.realNumbers ?? ""} />
                </Field>
                <button className="btn btn-soft btn-sm" type="submit">
                  Regenerate (replaces every field)
                </button>
                <AiFormStatus feature="ladder" enabled={ai} />
              </form>
            </Disclosure>
          </Card>
          <Card title="Where it goes">
            <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-2">
              <li>Personal profile first (warmest). Comment automation can&apos;t fire there, so the final rung&apos;s &quot;message me&quot; line is the fallback.</li>
              <li>Business page 24–48h later, composed natively. That&apos;s where comment automation works.</li>
              <li>Your own group after that. Other people&apos;s groups are guest posts, not a channel.</li>
              <li>Threads is natively a chain: the ladder is the native format there.</li>
              <li>Reels: 5 rungs, not 11, inside 20–30 minutes. Pin the last one.</li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
