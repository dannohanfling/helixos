import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { rotateInviteAction, saveBrandKitAction, updateBotFactsAction, updateGoalAction, updateProfileAction, updateWorkspaceAction } from "@/lib/actions/settings";
import { brandKitWarnings, contrastRatio } from "@/lib/engine/subject";
import { CopyButton } from "@/components/copy-button";
import { Card, Field, PageHeader } from "@/components/ui";
import { GhlConnect } from "@/components/ghl-connect";
import { ChangePasswordForm } from "@/components/change-password-form";
import { AiKeyCard } from "@/components/ai-key-card";
import { FathomKeyCard } from "@/components/fathom-key-card";
import { connectionFor } from "@/lib/ghl";
import { getIntegration, onboardingOpen } from "@/lib/integrations";
import { reapOrphans, storageQuota } from "@/lib/queries/proof-attachments";
import { mb } from "@/lib/engine/proof-attachments";
import { SubmitButton } from "@/components/submit-button";
import { QUALIFYING_DEFAULTS } from "@/lib/engine/bot-fields";

export const metadata = { title: "Settings" };

const TIMEZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ fathom?: string; brand?: string; draft?: string }> }) {
  const v = await requireViewer();
  // The storage figure counts rows; an object without a row (an upload that never finished recording) is reconciled away
  // here, the one place the workspace's holdings are looked at, so the figure and the store agree. After the response:
  // the page never waits on the store, and a store that is down costs the reader nothing.
  after(() => reapOrphans(v.workspace.id));
  const storage = await storageQuota(v.workspace.id);
  const { fathom: fathomNotice, brand: brandNotice, draft } = await searchParams;
  const savedKit = v.role === "coach" ? await db.query.brandKits.findFirst({ where: eq(schema.brandKits.workspaceId, v.workspace.id) }) : null;
  // A refused kit comes back as typed, so the person fixes the one pair named rather than typing thirteen fields again.
  const parseDraft = (raw: string | undefined): Partial<schema.BrandKit> | undefined => {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as Partial<schema.BrandKit>;
    } catch {
      return undefined;
    }
  };
  const attempted = parseDraft(draft);
  const brandKit: Partial<schema.BrandKit> | undefined = attempted ? { ...(savedKit ?? {}), ...attempted } : (savedKit ?? undefined);
  const [goal, conn, ghlIntegration] = await Promise.all([db.query.goals.findFirst({ where: and(eq(schema.goals.userId, v.user.id), eq(schema.goals.primary, true)) }), connectionFor(v.user.id), getIntegration(v.workspace.id, "gohighlevel")]);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return (
    <>
      <PageHeader title="Settings" />
      <Card className="mb-4" title="🚀 Publishing (your GoHighLevel sub-account)">
        <p className="mb-3 text-sm text-ink-2">Connect your own GoHighLevel sub-account once. Posts you schedule in the composer land in your Social Planner and go out on their own. Your token is encrypted and only ever used for your sub-account.</p>
        <GhlConnect conn={conn ?? null} tz={v.tz} role={v.role} open={onboardingOpen(ghlIntegration?.config)} />
      </Card>
      <div className="mb-4" id="ai">
        <AiKeyCard v={v} />
      </div>
      <div className="mb-4">
        <FathomKeyCard v={v} notice={fathomNotice} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Password">
          <ChangePasswordForm />
        </Card>
        <Card id="you" title="You">
          <form action={updateProfileAction} className="space-y-3">
            <div className="grid grid-cols-[4rem_1fr] gap-3">
              <Field label="Emoji">
                <input className="field text-center" name="avatarEmoji" defaultValue={v.user.avatarEmoji} maxLength={4} />
              </Field>
              <Field label="Name">
                <input className="field" name="name" defaultValue={v.user.name} />
              </Field>
            </div>
            <Field label="Business">
              <input className="field" name="businessName" defaultValue={v.membership.businessName ?? ""} />
            </Field>
            <Field label="Big promise" hint="I help [who] go from [pain] to [outcome] in [time] without [thing they hate].">
              <textarea className="field" name="bigPromise" defaultValue={v.membership.bigPromise ?? ""} />
            </Field>
            {/* Label and helper line are Danno's to write; the field name stands in until then. */}
            <Field label="Audience">
              <input className="field" name="audience" defaultValue={v.membership.audience ?? ""} data-testid="audience-field" />
            </Field>
            <Field label="Your timezone" hint="Sets what 'today' means for your lock-in, close, streak and reminders.">
              <select className="field" name="timezone" defaultValue={v.membership.timezone ?? v.workspace.timezone}>
                {Array.from(new Set([v.workspace.timezone, ...(v.membership.timezone ? [v.membership.timezone] : []), ...TIMEZONES])).map((tz) => (
                  <option key={tz}>{tz}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Morning reminder (hour)">
                <input className="field" name="reminderHour" type="number" min={0} max={23} defaultValue={v.membership.reminderHour} />
              </Field>
              <Field label="Evening reminder (hour)">
                <input className="field" name="eveningReminderHour" type="number" min={0} max={23} defaultValue={v.membership.eveningReminderHour} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="leaderboardOptIn" defaultChecked={v.membership.leaderboardOptIn} /> Show me on the weekly leaderboard
            </label>
            <SubmitButton className="btn btn-primary" pendingText="Saving…">
              Save
            </SubmitButton>
          </form>
        </Card>
        <Card id="your-bot" title="What your bot says about your business">
          <p className="mb-3 text-xs text-ink-3">Yours, not any one offer&apos;s. <a href="/brain" className="underline">Your bot</a> shows exactly what it will be sent, for you to approve before anything goes.</p>
          <form action={updateBotFactsAction} className="space-y-3">
            <Field label="What I do" hint="One paragraph, the first thing your bot knows about you.">
              <textarea className="field" name="whatIDo" rows={4} defaultValue={v.membership.whatIDo ?? ""} data-testid="what-i-do" />
            </Field>
            {[v.membership.botQuestion1, v.membership.botQuestion2, v.membership.botQuestion3].map((q, i) => (
              <Field key={i} label={`Question ${i + 1} your bot asks before booking`} hint="Blank uses the house question shown.">
                <input className="field" name={`botQuestion${i + 1}`} defaultValue={q ?? ""} placeholder={QUALIFYING_DEFAULTS[i]} data-testid={`bot-question-${i + 1}`} />
              </Field>
            ))}
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Your guarantee&apos;s full terms</summary>
              <p className="mt-2 text-xs text-ink-3">Kept here for the terms page and, later, for tracking who has earned it. Your bot is sent only the guarantee line you approve on Your bot.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Window, in months">
                  <input className="field tabular" name="termsWindowMonths" type="number" min={0} defaultValue={v.membership.guaranteeTerms.windowMonths ?? ""} />
                </Field>
                <Field label="Attendance, % of scheduled calls">
                  <input className="field tabular" name="termsAttendancePct" type="number" min={0} max={100} defaultValue={v.membership.guaranteeTerms.attendancePct ?? ""} />
                </Field>
                <Field label="A replay counts if watched within, days">
                  <input className="field tabular" name="termsReplayDays" type="number" min={0} defaultValue={v.membership.guaranteeTerms.replayDays ?? ""} />
                </Field>
                <Field label="Terms page (link)">
                  <input className="field" name="guaranteeTermsUrl" type="url" defaultValue={v.membership.guaranteeTermsUrl ?? ""} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="How it's measured">
                    <textarea className="field" name="termsMeasure" rows={2} defaultValue={v.membership.guaranteeTerms.measure ?? ""} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Conditions, one per line">
                    <textarea className="field" name="termsConditions" rows={4} defaultValue={(v.membership.guaranteeTerms.conditions ?? []).join("\n")} />
                  </Field>
                </div>
                <Field label="Exclusions">
                  <textarea className="field" name="termsExclusions" rows={2} defaultValue={v.membership.guaranteeTerms.exclusions ?? ""} />
                </Field>
                <Field label="Remedy">
                  <textarea className="field" name="termsRemedy" rows={2} defaultValue={v.membership.guaranteeTerms.remedy ?? ""} />
                </Field>
              </div>
            </details>
            <SubmitButton className="btn btn-primary" pendingText="Saving…" data-testid="save-bot-facts">
              Save
            </SubmitButton>
          </form>
        </Card>
        <Card title="Your data">
          <p className="text-sm text-ink-2">Everything you&apos;ve put into HelixOS belongs to you. Download it any time; it&apos;s the same file you&apos;d get when you leave.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <a className="btn btn-primary btn-sm" href="/api/export?format=json" download>Download everything (JSON)</a>
            <a className="btn btn-ghost btn-sm" href="/api/export?format=csv&table=leads" download>Leads (CSV)</a>
            <a className="btn btn-ghost btn-sm" href="/api/export?format=csv&table=content" download>Content (CSV)</a>
            <a className="btn btn-ghost btn-sm" href="/api/export?format=csv&table=client_records" download>Client records (CSV)</a>
          </div>
          <p className="mt-2 text-xs text-ink-3">Passwords and your GoHighLevel token are never included.</p>
        </Card>
        <Card id="storage" title="Storage">
          <p className="text-sm" data-testid="storage-line">{storage.line}</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded bg-surface-2" aria-hidden="true">
            <div className={`h-full ${storage.blocked ? "bg-danger" : storage.warn ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.round(storage.fraction * 100)}%` }} />
          </div>
          {storage.warn ? <p className="mt-2 text-xs text-warn" data-testid="storage-warn">Getting close. New attachments stop at {mb(storage.limit)}; delete ones you no longer need to keep room.</p> : null}
          {storage.blocked ? <p className="mt-2 text-xs text-danger" data-testid="storage-blocked">Full. New attachments are refused until something is deleted.</p> : null}
          <p className="mt-2 text-xs text-ink-3">Attachments on your proofs, in private storage.</p>
        </Card>
        <Card id="goal" title="Your one goal">
          <form action={updateGoalAction} className="space-y-3">
            <Field label="Goal">
              <input className="field" name="title" defaultValue={goal?.title ?? "Cash collected this month"} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Target">
                <input className="field tabular" name="target" type="number" min={1} defaultValue={goal?.target ?? 5000} />
              </Field>
              <Field label="So far">
                <input className="field tabular" name="actual" type="number" min={0} defaultValue={goal?.actual ?? 0} />
              </Field>
              <Field label="Unit">
                <select className="field" name="unit" defaultValue={goal?.unit ?? "$"}>
                  <option value="$">$</option>
                  <option value="clients">clients</option>
                  <option value="calls">calls</option>
                  <option value="leads">leads</option>
                </select>
              </Field>
            </div>
            <Field label="Period">
              <input className="field" name="period" defaultValue={goal?.period ?? "This month"} />
            </Field>
            <p className="text-xs text-ink-3">Cash you log in the evening close adds to a $ goal automatically.</p>
            <SubmitButton className="btn btn-primary" pendingText="Saving…">
              Save goal
            </SubmitButton>
          </form>
        </Card>
        {v.role === "coach" ? (
          <>
            <Card title="Workspace">
              <form action={updateWorkspaceAction} className="space-y-3">
                <Field label="Name">
                  <input className="field" name="name" defaultValue={v.workspace.name} />
                </Field>
                <Field label="Timezone" hint="Controls what 'today' means for streaks and reminders.">
                  <select className="field" name="timezone" defaultValue={v.workspace.timezone}>
                    {TIMEZONES.map((tz) => (
                      <option key={tz}>{tz}</option>
                    ))}
                  </select>
                </Field>
                <Field label="HelixOS Airtable base ID" hint="Run `npm run import:airtable` to refresh pathway, curriculum, and DM templates from your base.">
                  <input className="field" name="airtableBaseId" defaultValue={v.workspace.airtableBaseId ?? ""} placeholder="appXXXXXXXXXXXXXX" />
                </Field>
                <SubmitButton className="btn btn-primary" pendingText="Saving…">
                  Save workspace
                </SubmitButton>
              </form>
            </Card>
            <Card title="Brand kit" action={savedKit ? <span className="text-xs text-ink-3">ink on ground {contrastRatio(savedKit.ground, savedKit.ink)}:1</span> : null}>
              <div id="brand-kit" />
              <p className="mb-3 text-sm text-ink-2">The colours and faces a client-facing file is rendered in: the deck reads these. Six-digit hex, no #. A pair that cannot read on a slide is refused here, not discovered on screen.</p>
              {savedKit && brandKitWarnings(savedKit).length ? (
                <ul className="mb-3 list-disc rounded-lg bg-warn-soft p-2 pl-6 text-sm" data-testid="brand-warnings">
                  {brandKitWarnings(savedKit).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              ) : null}
              {brandNotice === "saved" ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" data-testid="brand-saved" role="status">Brand kit saved.</p> : brandNotice ? <p className="mb-3 rounded-lg border border-danger bg-danger-soft p-2 text-sm" data-testid="brand-refused" role="alert">{brandNotice}</p> : null}
              <form action={saveBrandKitAction} className="grid gap-3 sm:grid-cols-2" data-testid="brand-form">
                <div className="sm:col-span-2">
                  <Field label="Name">
                    <input className="field" name="name" defaultValue={brandKit?.name ?? ""} placeholder="Turas — True North" />
                  </Field>
                </div>
                {(["ground", "ink", "accent", "muted", "surface"] as const).map((role) => (
                  <Field key={role} label={role} hint={role === "ground" ? "page background" : role === "ink" ? "headline and body text" : role === "accent" ? "emphasis and calls to action only" : role === "muted" ? "secondary text" : "panels, the alternate ground"}>
                    <input className="field font-mono" name={role} defaultValue={brandKit?.[role] ?? ""} maxLength={7} />
                  </Field>
                ))}
                <Field label="inverseGround" hint="full-bleed slides, optional">
                  <input className="field font-mono" name="inverseGround" defaultValue={brandKit?.inverseGround ?? ""} maxLength={7} />
                </Field>
                <Field label="inverseInk" hint="text on inverseGround, optional">
                  <input className="field font-mono" name="inverseInk" defaultValue={brandKit?.inverseInk ?? ""} maxLength={7} />
                </Field>
                <Field label="Display face" hint="headlines">
                  <input className="field" name="displayFont" defaultValue={brandKit?.displayFont ?? ""} />
                </Field>
                <Field label="Body face">
                  <input className="field" name="bodyFont" defaultValue={brandKit?.bodyFont ?? ""} />
                </Field>
                <Field label="Quote face" hint="pull quotes, optional">
                  <input className="field" name="quoteFont" defaultValue={brandKit?.quoteFont ?? ""} />
                </Field>
                <Field label="Fallback face" hint="what the file names when a brand face is missing on the reader's machine; a licensed face needs one">
                  <input className="field" name="fontFallback" defaultValue={brandKit?.fontFallback ?? "Arial"} />
                </Field>
                <Field label="Banned colours" hint="hex, comma-separated: a kit using one is refused">
                  <input className="field font-mono" name="bannedColors" defaultValue={brandKit?.bannedColors?.join(", ") ?? ""} />
                </Field>
                <Field label="Placeholder colour" hint="the fill an unfilled [placeholder] is drawn in on a slide, so it cannot be missed; empty means FFF3A3. Ink must read on it.">
                  <input className="field font-mono" name="placeholder" defaultValue={brandKit?.placeholder ?? ""} maxLength={7} />
                </Field>
                <Field label="Permitted names" hint="names a script may introduce without a warning, comma-separated: a permitted name, never a second presenter">
                  <input className="field" name="aliases" defaultValue={brandKit?.aliases?.join(", ") ?? ""} data-testid="brand-aliases" />
                </Field>
                <label className="flex items-start gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" name="showPriceAnchor" value="1" defaultChecked={brandKit?.showPriceAnchor ?? true} className="mt-1" data-testid="brand-price-anchor" />
                  <span>
                    Price against total
                    <span className="block text-xs text-ink-3">The slide that puts your price next to the total value of the stack. Turn it off and the price stands on its own. Some brands do not allow the comparison.</span>
                  </span>
                </label>
                <Field label="Notes" hint="shown to you, never rendered">
                  <input className="field" name="notes" defaultValue={brandKit?.notes ?? ""} />
                </Field>
                <div className="sm:col-span-2">
                  <SubmitButton className="btn btn-primary" pendingText="Saving…">Save brand kit</SubmitButton>
                </div>
              </form>
            </Card>
            <Card title="Invite links">
              <div className="space-y-3 text-sm">
                <div>
                  <div className="label">Clients</div>
                  <div className="flex items-center gap-2">
                    <code className="field truncate">{`${appUrl}/join/${v.workspace.clientInviteCode}`}</code>
                    <CopyButton text={`${appUrl}/join/${v.workspace.clientInviteCode}`} />
                  </div>
                </div>
                <div>
                  <div className="label">Coaches / team</div>
                  <div className="flex items-center gap-2">
                    <code className="field truncate">{`${appUrl}/join/${v.workspace.coachInviteCode}`}</code>
                    <CopyButton text={`${appUrl}/join/${v.workspace.coachInviteCode}`} />
                  </div>
                  <p className="mt-1 text-xs text-warn" data-testid="coach-code-warning">Anyone with this link becomes a coach. Share it only with your team, and rotate it after use.</p>
                </div>
                <div className="flex gap-2">
                  <form action={rotateInviteAction}>
                    <input type="hidden" name="which" value="client" />
                    <SubmitButton className="btn btn-ghost btn-xs" pendingText="Rotating…">
                      Rotate client code
                    </SubmitButton>
                  </form>
                  <form action={rotateInviteAction}>
                    <input type="hidden" name="which" value="coach" />
                    <SubmitButton className="btn btn-ghost btn-xs" pendingText="Rotating…">
                      Rotate coach code
                    </SubmitButton>
                  </form>
                </div>
              </div>
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
