import { formatPrice } from "@/lib/engine/offer-score";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { pushKeywordsAction, saveLadderProfileAction } from "@/lib/actions/ladders";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { DEFAULT_BANNED, targetWords } from "@/lib/engine/ladder";
import { KEYWORD_KINDS, type LadderKeyword } from "@/db/schema";
import { KEYWORDS_FIELD, parseRouterKeywords } from "@/lib/engine/keyword-fields";
import { keywordPreview } from "@/lib/community-loyalty";
import { formatDateTime } from "@/lib/dates";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Ladder facts" };

const KIND_LABEL: Record<(typeof KEYWORD_KINDS)[number], string> = { comment: "a comment", dm: "a DM", both: "a comment or a DM" };

export default async function LadderProfilePage({ searchParams }: { searchParams: Promise<{ keywords?: string; note?: string }> }) {
  const v = await requireViewer({ team: "allow" });
  const sp = await searchParams;
  const [profile, offer, proofs, magnets] = await Promise.all([
    db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, v.workspace.id), eq(schema.ladderProfiles.userId, v.user.id)) }),
    db.query.offers.findFirst({ where: eq(schema.offers.userId, v.user.id), orderBy: desc(schema.offers.createdAt) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, v.workspace.id), eq(schema.proofs.userId, v.user.id), eq(schema.proofs.status, "approved")) }),
    db.query.leadMagnets.findMany({ where: eq(schema.leadMagnets.userId, v.user.id), columns: { id: true, title: true } }),
  ]);
  // The keyword rows: every keyword saved, then two blank rows to add to.
  const rows: (LadderKeyword | null)[] = [...(profile?.keywords ?? []), null, null];
  const targetValue = (k: LadderKeyword | null): string => (!k?.target ? "" : k.target.kind === "magnet" ? `magnet:${k.target.magnetId ?? ""}` : k.target.kind);
  // The bot: what it holds for keywords against what HelixOS would send (read live, nothing sent); never while switched or for a team member.
  const bot = v.switchedInto || v.team ? null : await keywordPreview(v.membership);
  const held = bot?.held ?? parseRouterKeywords(v.membership.clKeywordsHeld[KEYWORDS_FIELD]);
  const p = profile ?? null;
  const priceGuess = offer?.price ? `${formatPrice(offer.price, offer.currency)}${offer.paymentPlan ? `, or ${offer.paymentPlan}` : ""}` : "";
  return (
    <>
      <PageHeader title="Your ladder facts" subtitle={<span><Link href="/content/ladders" className="hover:underline">← Ladders</Link> · Everything a ladder may say about you, your offer and your numbers. Set once, used by every ladder.</span>} />
      <form action={saveLadderProfileAction} className="grid gap-4 lg:grid-cols-2">
        <Card title="Product">
          <div className="space-y-3">
            <Field label="Product or program name" hint="The thing the keyword sends people to.">
              <input className="field" name="productName" defaultValue={p?.productName ?? offer?.name ?? ""} required placeholder="The 90-Day Reset" />
            </Field>
            <Field label="What it is, in one or two plain sentences" hint="Say what it catches, speeds up or removes. Never what it 'generates'.">
              <textarea className="field" name="productPitch" rows={2} defaultValue={p?.productPitch ?? offer?.promise ?? ""} />
            </Field>
            <Field label="Price line, exactly as it should appear" hint="Used verbatim in the final rung.">
              <input className="field" name="priceLine" defaultValue={p?.priceLine ?? priceGuess} placeholder="$100 a month" />
            </Field>
            <Field label="Trial or entry line" hint="Optional. Also verbatim.">
              <input className="field" name="trialLine" defaultValue={p?.trialLine ?? ""} placeholder="Free 30 days, no card" />
            </Field>
            <div>
              <span className="label">Keywords</span>
              <p className="mb-2 text-xs text-ink-3">Each keyword fetches one thing: your product (price and entry terms in the final rung), one of your lead magnets (named once, no price), or a conversation with one line you write (no price, no product name). The first is the default. A keyword with no target cannot carry a ladder to ready.</p>
              <div className="space-y-2" data-testid="keyword-rows">
                {rows.map((k, i) => (
                  <div key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-6" data-testid="keyword-row">
                    <input className="field uppercase" name={`kw_${i}_keyword`} defaultValue={k?.keyword ?? ""} placeholder="RESET" aria-label="Keyword" data-testid={`kw-${i}-keyword`} />
                    <input className="field sm:col-span-2" name={`kw_${i}_use`} defaultValue={k?.use ?? ""} placeholder="what it's for" aria-label="What it's for" />
                    <select className="field" name={`kw_${i}_target`} defaultValue={targetValue(k)} aria-label="What it fetches" data-testid={`kw-${i}-target`}>
                      <option value="">No target yet</option>
                      <option value="product">The product</option>
                      {magnets.map((m) => (
                        <option key={m.id} value={`magnet:${m.id}`}>Magnet: {m.title}</option>
                      ))}
                      <option value="conversation">A conversation</option>
                    </select>
                    <select className="field" name={`kw_${i}_kind`} defaultValue={k?.kind ?? "both"} aria-label="Where the bot listens">
                      {KEYWORD_KINDS.map((kind) => (
                        <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>
                      ))}
                    </select>
                    <input className="field" name={`kw_${i}_tag`} defaultValue={k?.tag ?? ""} placeholder={k?.keyword ? `helix:${k.keyword}` : "tag"} aria-label="Tag" />
                    <input className="field sm:col-span-6" name={`kw_${i}_line`} defaultValue={k?.target?.kind === "conversation" ? (k.target.line ?? "") : ""} placeholder="For a conversation: the one line, in your words (ROOM: a conversation about the Academy and the community)" aria-label="The conversation's line" data-testid={`kw-${i}-line`} />
                  </div>
                ))}
              </div>
            </div>
            <Field label="Permitted scarcity line" hint="The ONLY scarcity a ladder may use, verbatim. Leave blank for none. Anything else is flagged as fake scarcity.">
              <input className="field" name="scarcityLine" defaultValue={p?.scarcityLine ?? ""} placeholder="Founding members lock $100 a month for life. That price is real. It won't stay this low forever." />
            </Field>
          </div>
        </Card>
        <Card title="What may be claimed">
          <div className="space-y-3">
            <Field label="Verified stats" hint="One per line, source in brackets. Ladders may cite these and nothing else.">
              <textarea className="field" name="verifiedStats" rows={5} defaultValue={p?.verifiedStats.map((s) => (s.source ? `${s.stat} (${s.source})` : s.stat)).join("\n") ?? ""} placeholder={"Leads answered in 5 minutes are 21x more likely to qualify than at 30 minutes (MIT / InsideSales, 2007)\nSMS reminders cut non-attendance 38% in a healthcare study (Imperial College London, 2008)"} />
            </Field>
            <Field label="Extra claims rules" hint="Anything specific to you the writer must never get wrong.">
              <textarea className="field" name="claimsRules" rows={3} defaultValue={p?.claimsRules ?? ""} placeholder="Company revenue is not my income. I was one of the promoters, not the owner." />
            </Field>
            <Field label="Banned phrases" hint={`One per line. Always banned for everyone: ${DEFAULT_BANNED.slice(0, 3).map((b) => `"${b}"`).join(", ")}.`}>
              <textarea className="field" name="bannedPhrases" rows={3} defaultValue={p?.bannedPhrases.join("\n") ?? ""} placeholder={"cheat day\nskinny"} />
            </Field>
            <div className="rounded-lg bg-surface-2 p-2 text-xs text-ink-2">
              Approved testimonials come from your <Link href="/proof" className="underline">Proof Bank</Link>: {proofs.length} approved. Ladders quote those verbatim, first name and last initial, and write [PROOF PLACEHOLDER] for anything else.
            </div>
          </div>
        </Card>
        <Card title="Origin story">
          <div className="space-y-3">
            <Field label="Your origin story, the version you tell" hint="Recurring source material. Keep the odd specific details; they make it feel lived.">
              <textarea className="field" name="originStory" rows={8} defaultValue={p?.originStory ?? ""} />
            </Field>
            <Field label="Positioning line" hint="Three short lines with slashes. Bio, webinar intro, cover frames.">
              <input className="field" name="positioningLine" defaultValue={p?.positioningLine ?? ""} placeholder="NIGHTCLUB PROMOTER. / BUSINESS CONSULTANT. / SAME PLAYBOOK." />
            </Field>
            <Field label="Handle for the graphic watermark">
              <input className="field" name="handle" defaultValue={p?.handle ?? ""} placeholder="@yourhandle" />
            </Field>
          </div>
        </Card>
        <Card title="The rules every ladder follows">
          <ul className="space-y-1 text-xs text-ink-2">
            <li>4th-grade reading level, 5–7 words a sentence, a line break between thoughts. These are format rules for a comment thread read on a phone, not a house voice; the voice is yours, from your Essence.</li>
            <li>No hype, no manufactured urgency.</li>
            <li>The body ends in an open question, never &quot;comment KEYWORD&quot;. The keyword lives in the final rung.</li>
            <li>No revenue guarantees. Tools enable; people and offers produce. Client counts are exact.</li>
            <li>Every number is true or marked &quot;(Illustrative. Your numbers will differ.)&quot;</li>
            <li>Unverifiable quote: the post is refused. No real data for a numbers post: it can&apos;t go live.</li>
            <li>A reader who never buys still leaves with a usable system.</li>
          </ul>
          <SubmitButton className="btn btn-primary mt-4" pendingText="Saving…">
            Save facts
          </SubmitButton>
        </Card>
      </form>
      {bot ? (
        <Card id="bot-keywords" className="mt-4" title="Keywords on your bot" action={<span className="text-xs text-ink-3">{v.membership.clKeywordsPushedAt ? `Last pushed ${formatDateTime(v.membership.clKeywordsPushedAt, v.tz)}.` : "Not pushed yet."}</span>}>
          {sp.keywords === "sent" ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="keywords-pushed">Pushed and read back: your bot holds these keywords.</p> : sp.keywords === "failed" ? <p className="mb-3 rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="keywords-failed">{sp.note}</p> : sp.keywords === "note" ? <p className="mb-3 rounded-lg bg-surface-2 p-2 text-sm" role="status" data-testid="keywords-note">{sp.note}</p> : null}
          <p className="text-xs text-ink-3">Your Community Loyalty bot listens for these in comments and DMs, tags the person and hands off to your agent. HelixOS writes two fields by name and reads them back; it never deletes a field and never posts or comments as you.</p>
          {bot.blocked ? (
            <p className="mt-2 rounded-lg bg-warn-soft p-2 text-sm" data-testid="keywords-blocked">{bot.blocked}</p>
          ) : (
            <ul className="mt-2 divide-y text-sm" data-testid="keyword-plan">
              {bot.rows.map((r) => (
                <li key={r.name} className="flex items-center justify-between gap-2 py-1.5" data-testid="keyword-plan-row" data-field={r.name} data-status={r.status}>
                  <span className="font-mono text-xs">{r.name}</span>
                  <Badge tone={r.status === "same" ? "good" : "accent"}>{r.status === "same" ? "the bot holds this" : "will change"}</Badge>
                </li>
              ))}
            </ul>
          )}
          {held.length ? (
            <p className="mt-2 text-xs text-ink-2" data-testid="keywords-held">On the bot now: {held.map((k) => `${k.keyword} (${KIND_LABEL[k.kind] ?? k.kind}, ${k.fetch.kind})`).join(" · ")}</p>
          ) : null}
          <form action={pushKeywordsAction} className="mt-3">
            <input type="hidden" name="reason" value="profile page" />
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending to your bot…" disabled={Boolean(bot.blocked) || bot.rows.every((r) => r.status === "same")} data-testid="push-keywords">
              {bot.rows.every((r) => r.status === "same") && !bot.blocked ? "Your bot holds these already" : "Push keywords to your bot"}
            </SubmitButton>
          </form>
          <p className="mt-2 text-xs text-ink-3">{(profile?.keywords ?? []).filter((k) => k.target).map((k) => `${k.keyword} fetches ${targetWords(k, magnets.find((m) => m.id === k.target?.magnetId)?.title)}`).join(" · ") || "No keyword has a target yet."}</p>
        </Card>
      ) : null}
    </>
  );
}
