import Link from "next/link";
import { APP_VERSION } from "@/lib/version";
import { after } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { setCoachCanWorkAction } from "@/lib/actions/switch";
import { resetBrandKitAction, rotateInviteAction, saveBrandKitAction, updateBotFactsAction, updateGoalAction, updateProfileAction, updateWorkspaceAction } from "@/lib/actions/settings";
import { brandKitWarnings, contrastRatio } from "@/lib/engine/subject";
import { BrandKitEditor } from "@/components/brand-kit-editor";
import { ConfirmButton } from "@/components/confirm-button";
import { STARTER_KIT } from "@/lib/engine/deck";
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
import { MoneyInput } from "@/components/money-input";
import { QUALIFYING_DEFAULTS } from "@/lib/engine/bot-fields";
import { setHumanosAction } from "@/lib/actions/body";
import { linkedChats } from "@/lib/chat";
import { setChatProgressShareAction, unlinkChatAction } from "@/lib/actions/chat";
import { CHANNEL_LABELS } from "@/lib/engine/chat";
import { disconnectAppAction, setConnectedAppsOpenAction } from "@/lib/actions/mcp";
import { SCOPE_WORDS, isScope } from "@/lib/engine/mcp";
import { isNull } from "drizzle-orm";

export const metadata = { title: "Settings" };

const TIMEZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ fathom?: string; brand?: string; draft?: string; chat?: string; apps?: string; goalError?: string; field?: string }> }) {
  const v = await requireViewer();
  // The storage figure counts rows; an object without a row (an upload that never finished recording) is reconciled away
  // here, the one place the workspace's holdings are looked at, so the figure and the store agree. After the response:
  // the page never waits on the store, and a store that is down costs the reader nothing.
  after(() => reapOrphans(v.workspace.id));
  const storage = await storageQuota(v.workspace.id);
  const { fathom: fathomNotice, brand: brandNotice, draft, chat: chatParam, apps: appsParam, goalError } = await searchParams;
  const appsNote = appsParam === "disconnected" ? "Disconnected. That app can't reach your HelixOS any more." : appsParam === "open" ? "Clients may connect apps." : appsParam === "closed" ? "Clients can't connect apps, and their existing connections are cut." : null;
  const chatNote = chatParam === "linked" ? "Chat linked. Your coach's assistant knows it's you." : chatParam === "unlinked" ? "Chat unlinked." : chatParam === "missing" ? "That link isn't valid any more. Ask the assistant for a new one." : chatParam === "share-on" ? "Your progress is shared with your coach's assistant." : chatParam === "share-off" ? "Your progress is no longer shared." : null;
  const savedKit = v.role === "coach" ? await db.query.brandKits.findFirst({ where: eq(schema.brandKits.workspaceId, v.workspace.id) }) : null;
  // The coach's logos in their Images library, for the kit's logo pick (deck visuals §4).
  const logos = v.role === "coach" ? await db.query.deckImages.findMany({ where: and(eq(schema.deckImages.workspaceId, v.workspace.id), eq(schema.deckImages.userId, v.user.id), eq(schema.deckImages.kind, "logo")) }) : [];
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
  const [goal, conn, ghlIntegration, chats] = await Promise.all([db.query.goals.findFirst({ where: and(eq(schema.goals.userId, v.user.id), eq(schema.goals.primary, true)) }), connectionFor(v.user.id), getIntegration(v.workspace.id, "gohighlevel"), linkedChats(v.workspace.id, v.user.id)]);
  const apps = await db.query.connectedApps.findMany({ where: and(eq(schema.connectedApps.workspaceId, v.workspace.id), eq(schema.connectedApps.userId, v.user.id), isNull(schema.connectedApps.revokedAt)), orderBy: desc(schema.connectedApps.createdAt) });
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const goalCard = (
    <Card id="goal" title="Your one goal">
      <form action={updateGoalAction} className="space-y-3">
        {goalError ? (
          <p className="rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="goal-error">
            {goalError}
          </p>
        ) : null}
        <Field label="Goal">
          <input className="field" name="title" defaultValue={goal?.title ?? "Cash collected this month"} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Target">
            <MoneyInput name="target" plain defaultValue={goal?.target ?? 5000} data-testid="goal-target" />
          </Field>
          <Field label="So far">
            <MoneyInput name="actual" plain defaultValue={goal?.actual ?? 0} data-testid="goal-actual" />
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
  );
  // Switch to client (rev 216): what the coach changed while working in this member's HelixOS, for the member to see.
  const coachChangeRows = v.role === "client" ? await db.query.coachChanges.findMany({ where: and(eq(schema.coachChanges.clientMembershipId, v.membership.id), eq(schema.coachChanges.kind, "change")), orderBy: [desc(schema.coachChanges.createdAt)], limit: 50 }) : [];
  const coachNames = new Map((coachChangeRows.length ? await db.query.users.findMany({ where: inArray(schema.users.id, [...new Set(coachChangeRows.map((c) => c.coachUserId))]) }) : []).map((u) => [u.id, u.name]));
  const changesList = coachChangeRows.length ? (
    <ul className="mt-2 space-y-1 text-sm" data-testid="coach-changes">
      {coachChangeRows.map((c) => (
        <li key={c.id} data-testid="coach-change">
          <span className="font-medium">{c.action}</span>
          {c.item ? <> · &ldquo;{c.item}&rdquo;</> : null} · on {c.page} · by {coachNames.get(c.coachUserId) ?? "your coach"} (coach) · <span className="text-ink-3">{formatDateTime(c.createdAt.replace(" ", "T") + "Z", v.tz)}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="mt-2 text-sm text-ink-3">Your coach hasn&apos;t changed anything here.</p>
  );
  if (v.switchedInto) {
    // A coach in a client's HelixOS (rev 216): their account, consent, keys and connections are their own, shown only as set
    // or not set. What the coach may set up (the goal) stays; the rest is on the pages themselves.
    const first = v.switchedInto.clientName.split(" ")[0];
    const clientAi = await db.query.aiCredentials.findFirst({ where: and(eq(schema.aiCredentials.workspaceId, v.workspace.id), eq(schema.aiCredentials.userId, v.user.id)) });
    const status: [string, string][] = [
      ["Sign-in, name, email, password and time zone", `${first}'s own`],
      ["GoHighLevel publishing", conn ? "set" : "not set"],
      ["AI key", clientAi ? "set" : "not set"],
      ["Emails from HelixOS", `${v.membership.emailsEnabled ? "on" : "off"} (changed on your client page)`],
      ["Let my coach work in my HelixOS", v.membership.coachCanWork ? "on" : "off"],
      ["Their data: download and delete", `${first}'s own`],
    ];
    return (
      <>
        <PageHeader title="Settings" subtitle={`${first}'s account, consent, keys and connections are their own. Nothing here can be seen or changed from their HelixOS.`} />
        <Card className="mb-4" title="Account and connections">
          <ul className="space-y-1 text-sm" data-testid="switched-settings-status">
            {status.map(([k, val]) => (
              <li key={k} className="flex flex-wrap justify-between gap-2">
                <span>{k}</span>
                <span className="text-ink-2">{val}</span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          {goalCard}
          <Card id="your-coach" title="Changes by their coach">
            {changesList}
          </Card>
        </div>
      </>
    );
  }
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
        {/* HumanOS (rev 320/322): the member's own switch, off by default. Off hides the group and keeps the data; on shows it as it was. */}
        <Card id="humanos" title="HumanOS">
          <p className="text-sm text-ink-2">Food, training, sleep, practices and weigh-ins, in your HelixOS. Everything in it is private to you by default; sharing with your coach is a separate switch inside HumanOS settings, and so is letting AI use it.</p>
          <form action={setHumanosAction} className="mt-3 flex flex-wrap items-center gap-3" data-testid="humanos-form">
            <input type="hidden" name="on" value={v.membership.bodyEnabled ? "0" : "1"} />
            <span className="text-sm font-medium" data-testid="humanos-state">
              HumanOS: {v.membership.bodyEnabled ? "On" : "Off"}
            </span>
            <SubmitButton className={`btn btn-sm ${v.membership.bodyEnabled ? "btn-soft" : "btn-primary"}`} pendingText="Saving…" data-testid="humanos-toggle" disabled={!!v.switchedInto}>
              {v.membership.bodyEnabled ? "Turn off" : "Turn on HumanOS"}
            </SubmitButton>
            {v.membership.bodyEnabled ? <Link href="/body" className="text-xs underline">Open HumanOS →</Link> : null}
          </form>
          <p className="mt-2 text-xs text-ink-3">{v.membership.bodyEnabled ? "Turning it off hides HumanOS and keeps everything you logged; turn it back on and it's all still there." : "Nothing is deleted when it's off, and nothing is shared when it's on."}</p>
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
        {goalCard}
        <Card id="connected-apps" title="Connected apps">
          {/* The MCP server (rev 224): the apps this member let act as them, and the way to cut each one. */}
          {appsNote ? <p className="mb-2 text-sm text-good" data-testid="apps-note">{appsNote}</p> : null}
          {v.role === "coach" ? (
            <form action={setConnectedAppsOpenAction} className="mb-3 flex flex-wrap items-center gap-3 text-sm" data-testid="apps-open" data-on={v.workspace.connectedAppsOpen ? "1" : "0"}>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="connectedAppsOpen" defaultChecked={v.workspace.connectedAppsOpen} data-testid="apps-open-toggle" /> Connected apps open to clients
              </label>
              <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="apps-open-save">
                Save
              </SubmitButton>
            </form>
          ) : null}
          {apps.length ? (
            <ul className="divide-y text-sm" data-testid="connected-apps">
              {apps.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="connected-app" data-scopes={a.scopes.join(" ")}>
                  <span className="font-medium">{a.name}</span>
                  <span className="text-xs text-ink-3">{a.scopes.filter(isScope).map((s) => SCOPE_WORDS[s].label).join(", ") || "nothing yet"}</span>
                  <span className="text-xs text-ink-3">connected {formatDateTime(a.createdAt.includes("T") ? a.createdAt : a.createdAt.replace(" ", "T") + "Z", v.tz)}{a.lastUsedAt ? ` · last used ${formatDateTime(a.lastUsedAt, v.tz)} (${a.lastTool})` : " · not used yet"}</span>
                  <form action={disconnectAppAction} className="ml-auto">
                    <input type="hidden" name="id" value={a.id} />
                    <SubmitButton className="text-xs text-ink-3 underline" pendingText="Disconnecting…" data-testid="app-disconnect">
                      Disconnect
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2" data-testid="connected-apps-empty">None yet. <Link href="/connect" className="underline">Connect HelixOS to Claude</Link> to read and write your own HelixOS from a chat.</p>
          )}
        </Card>
        <Card id="linked-chats" title="Your coach's assistant">
          {/* Community Loyalty chat (rev 241): the member's own switch on progress pushes, then the chats they confirmed as theirs. */}
          {chatNote ? <p className="mb-2 text-sm text-good" data-testid="chat-note">{chatNote}</p> : null}
          <form action={setChatProgressShareAction} className="flex flex-wrap items-center gap-3 text-sm" data-testid="chat-share" data-on={v.membership.chatProgressShare ? "1" : "0"}>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="chatProgressShare" defaultChecked={v.membership.chatProgressShare} data-testid="chat-share-toggle" /> Let my coach&apos;s assistant know my progress
            </label>
            <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="chat-share-save">
              Save
            </SubmitButton>
          </form>
          <p className="mb-3 mt-2 text-xs text-ink-3">When it&apos;s on, your coach&apos;s assistant gets your pathway stage, your goal, this week&apos;s 3-1-3 and your main offer, so it can help where you are. Never HumanOS, keys or notes.</p>
          <h3 className="text-sm font-semibold">Linked chats</h3>
          {chats.length ? (
            <ul className="divide-y text-sm" data-testid="linked-chats">
              {chats.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="linked-chat" data-channel={c.channel}>
                  <span className="font-medium">{CHANNEL_LABELS[c.channel]}</span>
                  <span className="text-xs text-ink-3">linked {formatDateTime(c.linkedAt!, v.tz)}</span>
                  <form action={unlinkChatAction} className="ml-auto">
                    <input type="hidden" name="id" value={c.id} />
                    <SubmitButton className="text-xs text-ink-3 underline" pendingText="Unlinking…" data-testid="chat-unlink">
                      Unlink
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2" data-testid="linked-chats-empty">None yet. When your coach&apos;s assistant sends you a &quot;confirm it&apos;s you&quot; link in a chat, confirming it lists that chat here.</p>
          )}
        </Card>
        {v.role === "client" ? (
          <Card id="your-coach" title="Your coach">
            {/* Switch to client (rev 216): the member's own choice, and what their coach changed while working in here. */}
            <form action={setCoachCanWorkAction} className="flex flex-wrap items-center gap-3 text-sm" data-testid="coach-work" data-on={v.membership.coachCanWork ? "1" : "0"}>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="coachCanWork" defaultChecked={v.membership.coachCanWork} data-testid="coach-work-toggle" /> Let my coach work in my HelixOS
              </label>
              <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="coach-work-save">
                Save
              </SubmitButton>
              {v.membership.programTier === "Luxe" ? <span className="text-xs text-ink-3" data-testid="coach-work-luxe">As part of Luxe, your coach works in your HelixOS with you.</span> : null}
            </form>
            <p className="mt-2 text-xs text-ink-3">Your coach can always look at your HelixOS to help you. With this on, they can also set things up for you (offers, webinars, tasks, Essence, groups, content). They never see HumanOS, send anything as you, or change your account.</p>
            <h3 className="mt-3 text-sm font-semibold">Changes by your coach</h3>
            {changesList}
          </Card>
        ) : null}
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
              {!savedKit ? (
                <p className="mb-3 rounded-lg border border-accent bg-accent-soft p-2 text-sm" data-testid="brand-starter">
                  <strong>House starter kit: replace with your own.</strong> Your decks use these colours and faces until you save your own. Change any of them, give the kit your business name, and save.
                </p>
              ) : null}
              {brandNotice === "saved" ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" data-testid="brand-saved" role="status">Brand kit saved.</p> : brandNotice === "reset" ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" data-testid="brand-reset" role="status">Back to the house starter kit.</p> : brandNotice ? <p className="mb-3 rounded-lg border border-danger bg-danger-soft p-2 text-sm" data-testid="brand-refused" role="alert">{brandNotice}</p> : null}
              <form action={saveBrandKitAction} className="grid gap-3 sm:grid-cols-2" data-testid="brand-form">
                <BrandKitEditor
                  kit={{
                    name: brandKit?.name ?? "",
                    ground: brandKit ? (brandKit.ground ?? "") : (STARTER_KIT.ground ?? ""),
                    ink: brandKit ? (brandKit.ink ?? "") : (STARTER_KIT.ink ?? ""),
                    accent: brandKit ? (brandKit.accent ?? "") : (STARTER_KIT.accent ?? ""),
                    muted: brandKit ? (brandKit.muted ?? "") : (STARTER_KIT.muted ?? ""),
                    surface: brandKit ? (brandKit.surface ?? "") : (STARTER_KIT.surface ?? ""),
                    inverseGround: brandKit ? (brandKit.inverseGround ?? "") : (STARTER_KIT.inverseGround ?? ""),
                    inverseInk: brandKit ? (brandKit.inverseInk ?? "") : (STARTER_KIT.inverseInk ?? ""),
                    displayFont: brandKit ? (brandKit.displayFont ?? "") : (STARTER_KIT.displayFont ?? ""),
                    bodyFont: brandKit ? (brandKit.bodyFont ?? "") : (STARTER_KIT.bodyFont ?? ""),
                    quoteFont: brandKit ? (brandKit.quoteFont ?? "") : (STARTER_KIT.quoteFont ?? ""),
                    fontFallback: brandKit?.fontFallback ?? STARTER_KIT.fontFallback,
                    logoImageId: brandKit?.logoImageId ?? "",
                    logoDarkImageId: brandKit?.logoDarkImageId ?? "",
                  }}
                  logos={logos.map((l) => ({ id: l.id, caption: l.caption, width: l.width, height: l.height }))}
                  workspaceId={v.workspace.id}
                  userId={v.user.id}
                />
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
              {savedKit ? (
                <form action={resetBrandKitAction} className="mt-3 border-t pt-3">
                  <ConfirmButton message="Go back to the house starter kit? Your saved colours, faces and logo choice are cleared from the kit; your logo stays in Images." className="btn btn-ghost btn-sm" pendingText="Resetting…">
                    Reset to the starter kit
                  </ConfirmButton>
                </form>
              ) : null}
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
      {/* The version this deploy is (rev 193), linking to What's new. */}
      <p className="mt-6 text-center text-xs text-ink-3">
        <Link href="/whats-new" className="hover:text-ink" data-testid="settings-version">
          {APP_VERSION}
        </Link>
      </p>
    </>
  );
}
