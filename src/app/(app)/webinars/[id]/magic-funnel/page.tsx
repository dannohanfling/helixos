import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { magicFunnelKeySet } from "@/lib/ai";
import { saveMfSetupAction } from "@/lib/actions/magic-funnel";
import { factsFor, mfAvailable, pagesToday, setupFor } from "@/lib/mf/data";
import { DAILY_CAP_DEFAULT, DEFAULT_PROMPT, EMPTY_DEFAULTS, MF_MAX, SECTION_MAX } from "@/lib/engine/magic-funnel";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { MfPreview } from "@/components/mf-preview";
import { CopyButton } from "@/components/copy-button";
import { MF_CLASSES, mfSnippet } from "@/lib/engine/mf-snippet";
import { siteUrl } from "@/lib/app-url";

export const metadata = { title: "Magic funnel" };

/**
 * Coach → Webinars → Magic funnel (revs 812, 815; rev 837's answers), per webinar: the facts the AI may use (the webinar's own
 * fields), three pillars, the agenda, objections answered from the facts, real urgency only, the Proof Bank items it may pick,
 * the voice and prompt box (Danno's IGDITD prompt to start), default copy for every section, the live switch, and the preview.
 */
export default async function MagicFunnelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; held?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, id), eq(schema.webinars.workspaceId, v.workspace.id), eq(schema.webinars.userId, v.user.id)) });
  if (!w) notFound();
  const m = { workspaceId: v.workspace.id, userId: v.user.id };
  const [setup, proofs, today, signups] = await Promise.all([
    setupFor(m, w.id),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, m.workspaceId), eq(schema.proofs.userId, m.userId), eq(schema.proofs.status, "approved")), orderBy: desc(schema.proofs.createdAt), columns: { id: true, name: true, who: true, quote: true, shortVersion: true, tags: true, permissionAt: true } }),
    pagesToday(m, v.tz),
    db.query.webinarSignups.findMany({ where: and(eq(schema.webinarSignups.webinarId, id), eq(schema.webinarSignups.userId, v.user.id)), columns: { source: true, pitchStatus: true, openedAt: true, registeredAt: true } }),
  ]);
  const facts = factsFor(w, v.tz);
  const available = mfAvailable(v.membership);
  const d = { ...EMPTY_DEFAULTS, ...(setup?.defaults ?? {}) };
  const pillar = (i: number) => setup?.pillars.find((p) => p.id === `p${i}`);
  const consented = proofs.filter((p) => p.permissionAt);
  const cap = v.membership.mfDailyCap ?? DAILY_CAP_DEFAULT;
  // Counts only (rev 812 §7): the Magic funnel against plain registration in the chat. Attendance comes with its tags.
  const mf = signups.filter((x) => x.source === "mf");
  const counts = { made: mf.filter((x) => x.pitchStatus !== "none" && x.pitchStatus !== "writing").length, opened: mf.filter((x) => x.openedAt).length, registered: mf.filter((x) => x.registeredAt).length, plain: signups.filter((x) => x.source === "chat" && x.registeredAt).length };
  return (
    <>
      <PageHeader title="Magic funnel" subtitle={`${w.title}: a registration page written for each person your bot sends`} action={<Link href={`/webinars/${w.id}?step=run`} className="btn btn-ghost btn-sm">Back to the webinar</Link>} />
      {!available ? (
        <p className="mb-4 rounded-lg border border-warn bg-warn-soft p-3 text-sm" role="status" data-testid="mf-off">
          The Magic funnel isn&apos;t switched on for you yet. Your coach turns it on. You can set it up now; nothing goes live until then.
        </p>
      ) : null}
      {sp.held ? (
        <p className="mb-4 rounded-lg border border-warn bg-warn-soft p-3 text-sm" role="alert" data-testid="mf-held">
          Saved, but not live yet. Still needed: {sp.held}.
        </p>
      ) : sp.saved ? (
        <p className="mb-4 rounded-lg bg-good-soft p-3 text-sm" role="status" data-testid="mf-saved">
          Saved.
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={setup?.live ? "good" : "neutral"}>{setup?.live ? "Live" : "Not live"}</Badge>
        <span className="text-ink-3" data-testid="mf-key">{magicFunnelKeySet() ? "Writing with the small model." : "No writer key yet: every page uses your default copy until it's added."}</span>
        <span className="text-ink-3" data-testid="mf-today">
          {today} of {cap} pages today
        </span>
      </div>
      <Card className="mb-4" title="How it's going">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5" data-testid="mf-counts">
          <div><dt className="text-xs text-ink-3">Pages made</dt><dd className="tabular text-lg font-semibold" data-testid="mf-count-made">{counts.made}</dd></div>
          <div><dt className="text-xs text-ink-3">Opened</dt><dd className="tabular text-lg font-semibold" data-testid="mf-count-opened">{counts.opened}</dd></div>
          <div><dt className="text-xs text-ink-3">Registered from a page</dt><dd className="tabular text-lg font-semibold" data-testid="mf-count-registered">{counts.registered}</dd></div>
          <div><dt className="text-xs text-ink-3">Registered in the chat</dt><dd className="tabular text-lg font-semibold" data-testid="mf-count-plain">{counts.plain}</dd></div>
          <div><dt className="text-xs text-ink-3">Attended</dt><dd className="text-sm text-ink-3">once attendance tags come in</dd></div>
        </dl>
      </Card>
      <Card className="mb-4" title="Your GoHighLevel page">
        <p className="text-sm text-ink-2">Paste this into a Custom Code element on your registration page and on its thank-you page. Then mark the blocks it fills with these CSS classes (Advanced → CSS class in the builder). Add a hidden form field named mf_code for the workflow webhook. A block you don&apos;t mark stays as it is.</p>
        <div className="mt-2">
          <CopyButton text={mfSnippet(siteUrl())} label="Copy GHL snippet" className="btn btn-ghost btn-sm" />
        </div>
        <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2" data-testid="mf-classes">
          {MF_CLASSES.map((c) => (
            <li key={c.cls} className="min-w-0 [overflow-wrap:anywhere]">
              <code>{c.cls}</code> <span className="text-ink-3">· {c.what}</span>
            </li>
          ))}
        </ul>
      </Card>
      <form action={saveMfSetupAction} className="space-y-4">
        <input type="hidden" name="webinarId" value={w.id} />
        <Card title="The facts it may use">
          <p className="text-sm text-ink-2" data-testid="mf-facts">
            {facts.title} · {facts.when ?? "no date yet"} · {facts.promise || "no promise yet"}
          </p>
          <p className="mt-1 text-xs text-ink-3">From the webinar itself (Foundation and Run it): the title, date and time, the promise, what they&apos;ll learn and who it&apos;s for. The date always comes from here, never from copy.</p>
        </Card>
        <Card title="Three pillars">
          <div className="grid gap-3 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Field label={`Pillar ${i}`}>
                  <input className="field" name={`pillar_${i}_title`} maxLength={MF_MAX.pillarTitle} defaultValue={pillar(i)?.title ?? ""} data-testid={`mf-pillar-${i}-title`} />
                </Field>
                <Field label="Its default copy">
                  <textarea className="field" name={`pillar_${i}_copy`} rows={3} maxLength={MF_MAX.pillarCopy} defaultValue={pillar(i)?.copy ?? ""} data-testid={`mf-pillar-${i}-copy`} />
                </Field>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Agenda and objections">
          <Field label="Agenda items, one a line" hint="The page highlights the one most relevant to them, with a line on why.">
            <textarea className="field" name="agenda" rows={4} defaultValue={(setup?.agenda ?? []).map((a) => a.line).join("\n")} data-testid="mf-agenda" />
          </Field>
          <div className="mt-3 grid gap-2">
            {Array.from({ length: MF_MAX.objections }, (_, i) => setup?.objections[i] ?? { objection: "", answer: "" }).map((o, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <input className="field" name={`obj_${i}_q`} maxLength={MF_MAX.objection} placeholder={i === 0 ? "A doubt, like \"I don't have time\"" : "Another doubt (optional)"} defaultValue={o.objection} aria-label={`Objection ${i + 1}`} />
                <input className="field" name={`obj_${i}_a`} maxLength={MF_MAX.answer} placeholder="Answered only from the webinar facts" defaultValue={o.answer} aria-label={`Answer ${i + 1}`} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Real urgency only">
          <p className="mb-2 text-xs text-ink-3">The page may use only what you set here. With nothing set, urgency speaks to the cost of waiting and never mentions limits.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Seat cap">
              <input className="field" name="seatCap" type="number" min={1} defaultValue={setup?.urgency.seatCap ?? ""} data-testid="mf-seat-cap" />
            </Field>
            <Field label="Bonus deadline">
              <input className="field" name="bonusDeadline" type="date" defaultValue={setup?.urgency.bonusDeadline ?? ""} data-testid="mf-bonus-deadline" />
            </Field>
            <Field label="The bonus, in a line">
              <input className="field" name="bonusLine" maxLength={MF_MAX.bonusLine} defaultValue={setup?.urgency.bonusLine ?? ""} />
            </Field>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="liveOnly" value="1" defaultChecked={setup?.urgency.liveOnly ?? false} data-testid="mf-live-only" /> Live only, no replay
          </label>
        </Card>
        <Card title="Proof it may show">
          <p className="mb-2 text-xs text-ink-3">Approved items with the permission tick only, quoted word for word. Tick none to let it pick from all of them; tags matching their industry or pain go first. Edit the tags here; they&apos;re the Proof Bank&apos;s own.</p>
          {consented.length ? (
            <ul className="grid gap-1 sm:grid-cols-2" data-testid="mf-proofs">
              {consented.map((p) => (
                <li key={p.id}>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="proofIds" value={p.id} defaultChecked={(setup?.proofIds ?? []).includes(p.id)} className="mt-1" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="font-medium">{p.who || p.name}</span>
                    </span>
                  </label>
                  <input className="field mt-1 py-1 text-xs" name={`proofTags_${p.id}`} defaultValue={p.tags.join(", ")} placeholder="Tags: industry, pain" aria-label={`Tags for ${p.who || p.name}`} data-testid="mf-proof-tags" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">No approved proof with the permission tick yet. The page shows none until there is.</p>
          )}
        </Card>
        <Card title="The voice and prompt">
          <Field label="Prompt" hint="Starts as Danno's IGDITD prompt. {{First Name}} and {{Biggest Pain In Business}} are filled from their profile. The rules (real urgency only, no prices or invented results, written to them as the business owner) always apply on top.">
            <textarea className="field font-mono text-xs" name="prompt" rows={12} maxLength={MF_MAX.prompt} defaultValue={setup?.prompt ?? DEFAULT_PROMPT} data-testid="mf-prompt" />
          </Field>
        </Card>
        <Card title="Default copy">
          <p className="mb-2 text-xs text-ink-3">Used straight away while their page is written, for any section that fails its checks, and for everyone when there&apos;s no key or the day&apos;s cap is reached. Write &#123;first name&#125; where their name goes.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Header">
              <input className="field" name="d_header" maxLength={SECTION_MAX.header} defaultValue={d.header} data-testid="mf-d-header" />
            </Field>
            <Field label="Subheader">
              <input className="field" name="d_subheader" maxLength={SECTION_MAX.subheader} defaultValue={d.subheader} data-testid="mf-d-subheader" />
            </Field>
            <Field label="Button">
              <input className="field" name="d_ctaLabel" maxLength={SECTION_MAX.ctaLabel} defaultValue={d.ctaLabel} />
            </Field>
            <Field label="Why this is for you (three lines)">
              <textarea className="field" name="d_whyYou" rows={3} defaultValue={d.whyYou.join("\n")} />
            </Field>
            <Field label="Example title">
              <input className="field" name="d_exampleTitle" maxLength={SECTION_MAX.exampleTitle} defaultValue={d.exampleTitle} />
            </Field>
            <Field label="Example (no numbers)">
              <textarea className="field" name="d_example" rows={3} maxLength={SECTION_MAX.example} defaultValue={d.example} />
            </Field>
            <Field label="A doubt">
              <input className="field" name="d_objection" maxLength={SECTION_MAX.objection} defaultValue={d.objection.objection} />
            </Field>
            <Field label="Its answer">
              <input className="field" name="d_answer" maxLength={SECTION_MAX.answer} defaultValue={d.objection.answer} />
            </Field>
            <Field label="Emotional">
              <textarea className="field" name="d_emotional" rows={3} maxLength={SECTION_MAX.emotional} defaultValue={d.emotional} data-testid="mf-d-emotional" />
            </Field>
            <Field label="Logical">
              <textarea className="field" name="d_logical" rows={3} maxLength={SECTION_MAX.logical} defaultValue={d.logical} data-testid="mf-d-logical" />
            </Field>
            <Field label="Urgency">
              <textarea className="field" name="d_urgency" rows={3} maxLength={SECTION_MAX.urgency} defaultValue={d.urgency} />
            </Field>
            <Field label="Thank-you page title">
              <input className="field" name="d_ticketTitle" maxLength={SECTION_MAX.ticketTitle} defaultValue={d.ticketTitle} />
            </Field>
            <Field label="What to bring (two or three lines)">
              <textarea className="field" name="d_bring" rows={3} defaultValue={d.bring.join("\n")} />
            </Field>
          </div>
        </Card>
        <Card>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="live" value="1" defaultChecked={setup?.live ?? false} className="mt-1" data-testid="mf-live" />
            <span>
              Magic funnel live for this webinar
              <span className="block text-xs text-ink-3">Your bot&apos;s mf_prepare sends each person their own link to your registration page. Needs a registration page, a date, three pillars and the default copy.</span>
            </span>
          </label>
          <div className="mt-3">
            <SubmitButton className="btn btn-primary" pendingText="Saving…" data-testid="mf-save">
              Save
            </SubmitButton>
          </div>
        </Card>
      </form>
      <Card className="mt-4" title="Preview a person's page">
        {setup ? <MfPreview webinarId={w.id} pillars={setup.pillars.map((p) => ({ id: p.id, title: p.title }))} proofs={consented.map((p) => ({ id: p.id, line: `${p.who || p.name}: "${(p.quote ?? p.shortVersion ?? "").slice(0, 140)}"` }))} /> : <p className="text-sm text-ink-3">Save the setup first, then preview it.</p>}
      </Card>
    </>
  );
}
