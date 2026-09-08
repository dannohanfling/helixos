import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { saveLadderProfileAction } from "@/lib/actions/ladders";
import { Card, Field, PageHeader } from "@/components/ui";
import { DEFAULT_BANNED } from "@/lib/engine/ladder";

export const metadata = { title: "Ladder facts" };

export default async function LadderProfilePage() {
  const v = await requireViewer();
  const [profile, offer, proofs] = await Promise.all([
    db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, v.workspace.id), eq(schema.ladderProfiles.userId, v.user.id)) }),
    db.query.offers.findFirst({ where: eq(schema.offers.userId, v.user.id), orderBy: desc(schema.offers.createdAt) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, v.workspace.id), eq(schema.proofs.userId, v.user.id), eq(schema.proofs.status, "approved")) }),
  ]);
  const p = profile ?? null;
  const priceGuess = offer?.price ? `$${offer.price.toLocaleString()}${offer.paymentPlan ? `, or ${offer.paymentPlan}` : ""}` : "";
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
            <Field label="Keywords" hint="One per line: KEYWORD — what it's for. The first is the default.">
              <textarea className="field" name="keywords" rows={3} defaultValue={p?.keywords.map((k) => `${k.keyword} — ${k.use}`).join("\n") ?? ""} placeholder={"RESET — default, anything selling the Reset\nPLAN — the free starter plan"} />
            </Field>
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
          <button className="btn btn-primary mt-4" type="submit">
            Save facts
          </button>
        </Card>
      </form>
    </>
  );
}
