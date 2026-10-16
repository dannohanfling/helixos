import { siteUrl } from "@/lib/app-url";
import Link from "next/link";
import { APP_VERSION } from "@/lib/version";
import { after } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import { setCoachCanWorkAction } from "@/lib/actions/switch";
import { resetBrandKitAction, rotateInviteAction, saveBrandKitAction, updateBotFactsAction, updateGoalAction, updateProfileAction, updateWorkspaceAction } from "@/lib/actions/settings";
import { kitFor, kitStatus } from "@/lib/queries/brand-kit";
import { brandKitWarnings, contrastRatio } from "@/lib/engine/subject";
import { BrandKitEditor } from "@/components/brand-kit-editor";
import { ConfirmButton } from "@/components/confirm-button";
import { ConfirmDelete } from "@/components/confirm-delete";
import { STARTER_KIT } from "@/lib/engine/deck";
import { CopyButton } from "@/components/copy-button";
import { ADD_PERMISSION } from "@/lib/engine/post-picture";
import { saveMfDomainsAction } from "@/lib/actions/magic-funnel";
import { mfAvailable } from "@/lib/mf/data";
import { BotConnectionCard } from "@/components/bot-connection-card";
import { Card, Field, PageHeader } from "@/components/ui";
import { GhlConnect } from "@/components/ghl-connect";
import { PLATFORMS } from "@/lib/platforms";
import { ChangePasswordForm } from "@/components/change-password-form";
import { ChangeEmailForm } from "@/components/change-email-form";
import { ScrollToHash } from "@/components/scroll-to-hash";
import { AiKeyCard } from "@/components/ai-key-card";
import { FathomKeyCard } from "@/components/fathom-key-card";
import { connectionFor, listUsers } from "@/lib/ghl";
import { CL_COPY, GHL_COPY } from "@/lib/engine/connect-copy";
import { ClConnect } from "@/components/cl-connect";
import { agentChoicesFor, clTokenSet } from "@/lib/community-loyalty";
import { reapOrphans, storageQuota } from "@/lib/queries/proof-attachments";
import { mb } from "@/lib/engine/proof-attachments";
import { SubmitButton } from "@/components/submit-button";
import { appUrl as appBase } from "@/lib/branded-email";
import { MoneyInput } from "@/components/money-input";
import { QUALIFYING_DEFAULTS } from "@/lib/engine/bot-fields";
import { setHumanosAction } from "@/lib/actions/body";
import { setSoundsOnAction } from "@/lib/actions/scene";
import { linkedChats } from "@/lib/chat";
import { setChatProgressShareAction, unlinkChatAction } from "@/lib/actions/chat";
import { CHANNEL_LABELS } from "@/lib/engine/chat";
import { disconnectAppAction, setConnectedAppsOpenAction } from "@/lib/actions/mcp";
import { SCOPE_WORDS, isScope } from "@/lib/engine/mcp";
import { isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { TeamSettings } from "@/components/team-settings";
import { createTeamInviteAction, removeTeamMemberAction, revokeTeamInviteAction } from "@/lib/actions/team";
import { TEAM_INVITE_COOKIE, openInvites, seatsLeft, teamOf } from "@/lib/team";
import { TEAM_INVITE_DAYS, lastActiveWords, seatsLine } from "@/lib/engine/team";
import { MemberAvatar } from "@/components/member-avatar";
import { HeadshotUpload } from "@/components/headshot-upload";
import { EmojiPicker } from "@/components/emoji-picker";
import { hasHeadshot } from "@/lib/headshots";
import { removeMyHeadshotAction } from "@/lib/actions/headshots";
import { SKILL_INSTALL_STEPS } from "@/lib/engine/board-view";
import { forumSettingsFor } from "@/lib/forum";
import { ForumWebhookCard } from "@/components/forum-webhook";
import { setArenaHiddenAction, setArenaPhotoAction, setColosseumOnAction } from "@/lib/actions/colosseum";
import { setupFor } from "@/lib/setup-card";
import { SetupList } from "@/components/setup-card";

export const metadata = { title: "Settings" };

const TIMEZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ fathom?: string; brand?: string; draft?: string; chat?: string; apps?: string; goalError?: string; field?: string; team?: string; photo?: string; botError?: string; cl?: string; mf?: string; mfError?: string; humanos?: string }> }) {
  const v = await requireViewer({ team: "allow" });
  // H-94: the member's own Images, for "Choose from my media" on the photo card (never while a coach is switched in).
  const ownMedia = v.switchedInto ? [] : await db.query.deckImages.findMany({ where: and(eq(schema.deckImages.workspaceId, v.workspace.id), eq(schema.deckImages.userId, v.user.id)), columns: { id: true, caption: true, kind: true }, orderBy: (t, { desc }) => [desc(t.createdAt)], limit: 96 });
  // A team member (Danno, 6 Oct): their own sign-in, nothing of the owner's.
  // A client's loyalty leaderboard (rev 639, H-28), once the coach has set one up: whether it's connected and where its page
  // and feed live. Its words, tiers, rewards, export and hide list are edited on /loyalty. The key is never on this page.
  const leaderboard = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, v.membership.id), columns: { slug: true, keyEncrypted: true, exportJson: true } });
  if (v.team) return <TeamSettings v={v} loyalty={Boolean(leaderboard)} />;
  // The storage figure counts rows; an object without a row (an upload that never finished recording) is reconciled away
  // here, the one place the workspace's holdings are looked at, so the figure and the store agree. After the response:
  // the page never waits on the store, and a store that is down costs the reader nothing.
  after(() => reapOrphans(v.workspace.id));
  const storage = await storageQuota(v.workspace.id);
  const { fathom: fathomNotice, brand: brandNotice, draft, chat: chatParam, apps: appsParam, goalError, team: teamParam, photo: photoNotice, botError, cl: clNotice, mf: mfNotice, mfError, humanos: humanosNotice } = await searchParams;
  const appsNote = appsParam === "disconnected" ? "Disconnected. That app can't reach your HelixOS any more." : appsParam === "open" ? "Clients may connect apps." : appsParam === "closed" ? "Clients can't connect apps, and their existing connections are cut." : null;
  const chatNote = chatParam === "linked" ? "Chat linked. Your coach's assistant knows it's you." : chatParam === "unlinked" ? "Chat unlinked." : chatParam === "missing" ? "That link isn't valid any more. Ask the assistant for a new one." : chatParam === "share-on" ? "Your progress is shared with your coach's assistant." : chatParam === "share-off" ? "Your progress is no longer shared." : null;
  // The member's own kit (rev 568): every member has the card; a coach switched in sees and, with Work on, sets the client's.
  const savedKit = await kitFor(v.workspace.id, v.user.id);
  // The member's own logos in their Images library, for the kit's logo pick (deck visuals §4); never another member's.
  const logos = await db.query.deckImages.findMany({ where: and(eq(schema.deckImages.workspaceId, v.workspace.id), eq(schema.deckImages.userId, v.user.id), eq(schema.deckImages.kind, "logo")) });
  // The graphic's avatar (rev 513): a photo or a logo of the member's own.
  const avatars = await db.query.deckImages.findMany({ where: and(eq(schema.deckImages.workspaceId, v.workspace.id), eq(schema.deckImages.userId, v.user.id), inArray(schema.deckImages.kind, ["photo", "logo"])), orderBy: [desc(schema.deckImages.createdAt)] });
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
  const [goal, conn, chats] = await Promise.all([db.query.goals.findFirst({ where: and(eq(schema.goals.userId, v.user.id), eq(schema.goals.primary, true)) }), connectionFor(v.user.id), linkedChats(v.workspace.id, v.user.id)]);
  const forumHook = await forumSettingsFor({ workspaceId: v.workspace.id, userId: v.user.id });
  const apps = await db.query.connectedApps.findMany({ where: and(eq(schema.connectedApps.workspaceId, v.workspace.id), eq(schema.connectedApps.userId, v.user.id), isNull(schema.connectedApps.revokedAt)), orderBy: desc(schema.connectedApps.createdAt) });
  const appUrl = siteUrl();
  // The owner's team (Danno, 6 Oct): who is on it, the open invites, the seats, and what the team changed. Not while switched.
  const [team, invites, seats, teamChangeRows] = v.switchedInto
    ? [[], [], null, []]
    : await Promise.all([teamOf(v.membership.id), openInvites(v.membership.id), seatsLeft(v.membership), db.query.teamChanges.findMany({ where: and(eq(schema.teamChanges.ownerMembershipId, v.membership.id), eq(schema.teamChanges.kind, "change")), orderBy: [desc(schema.teamChanges.createdAt)], limit: 50 })]);
  const teamNames = new Map((teamChangeRows.length ? await db.query.users.findMany({ where: inArray(schema.users.id, [...new Set(teamChangeRows.map((c) => c.teamUserId))]) }) : []).map((u) => [u.id, u.name]));
  // The invite link just made, from the cookie the action left: shown this once, then the cookie is gone.
  const inviteCode = teamParam === "invited" ? ((await cookies()).get(TEAM_INVITE_COOKIE)?.value ?? null) : null;
  const teamNote = teamParam === "full" ? "No seat is free. Remove a team member or cancel an open invite first, or ask your coach for more seats." : teamParam === "removed" ? "Removed. Their access ended." : teamParam === "revoked" ? "Invite cancelled. That link no longer works." : null;
  // H-270 §1: every setup step with its tick, folded; the six "When you need them" steps live here once the card retires.
  const setupList = v.team ? null : <SetupList steps={await setupFor(v)} video={v.workspace.startHereVideo ?? null} canTick={!v.team} coach={Boolean(v.switchedInto)} />;
  const goalCard = (
    <Card id="goal" title="Your one goal" action={<Link href="/goals" className="text-xs text-ink-2 hover:underline" data-testid="goal-plan-link">Your Business goals →</Link>}>
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
      ["Community Loyalty bot", clTokenSet(v.membership) ? "set" : "not set"],
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
          {leaderboard ? (
            <p className="mt-2 text-sm" data-testid="switched-loyalty-link">
              Loyalty leaderboard:{" "}
              <Link href="/loyalty" className="underline">
                Open →
              </Link>
            </p>
          ) : null}
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          {setupList}
          {goalCard}
          <Card id="your-coach" title="Changes by their coach">
            {changesList}
          </Card>
        </div>
      </>
    );
  }
  // "Which user are you?" is a pick from the account's users, asked of GoHighLevel only while it is unanswered (rev 850).
  const ghlUsers = conn && conn.accounts.length && !conn.lastError && !conn.ghlUserId?.trim() ? await listUsers(conn) : [];
  const clAgents = clTokenSet(v.membership) ? await agentChoicesFor(v.membership) : [];
  return (
    <>
      <ScrollToHash />
      <PageHeader title="Settings" />
      <Card id="publishing" className="mb-4 scroll-mt-20" title={GHL_COPY.title} action={<Link href="/connect-tools" className="text-xs text-ink-2 hover:underline" data-testid="settings-connect-tools">Connect your tools, step by step →</Link>}>
        {conn?.mediaScopeMissingAt ? (
          <p className="mb-3 rounded-lg border border-warn bg-warn-soft p-2 text-sm" role="status" data-testid="ghl-add-permission">
            {ADD_PERMISSION}
          </p>
        ) : null}
        <GhlConnect conn={conn ?? null} tz={v.tz} users={ghlUsers} />
      </Card>
      <Card id="community-loyalty" className="mb-4 scroll-mt-20" title={CL_COPY.title}>
        <ClConnect connected={clTokenSet(v.membership)} m={v.membership} agents={clAgents} notice={clNotice ?? null} back="/settings" tz={v.tz} />
      </Card>
      <div className="mb-4" id="ai">
        <AiKeyCard v={v} />
      </div>
      <div className="mb-4">
        <FathomKeyCard v={v} notice={fathomNotice} />
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Card className="min-w-0" title="Password">
          <ChangePasswordForm />
        </Card>
        <Card id="login-email" className="min-w-0" title="Login email">
          <ChangeEmailForm current={v.user.email} />
        </Card>
        {/* Account (H-331): the pages the app stores point at, the export, and the two deletions a member can run alone. */}
        <Card id="account" className="min-w-0" title="Account">
          <ul className="space-y-2 text-sm" data-testid="account-links">
            <li>
              <Link href="/privacy" className="underline">Privacy Policy</Link> · <Link href="/terms" className="underline">Terms of Service</Link> · <Link href="/support" className="underline">Support</Link>
            </li>
            <li>
              <a href="/api/export?format=json" className="underline" download>Download my data</a>
              <span className="text-ink-3"> (everything you own here, as one JSON file)</span>
            </li>
            {v.switchedInto || v.team ? null : (
              <>
                <li>
                  <Link href="/settings/delete-humanos" className="underline" data-testid="account-delete-humanos">Delete my HumanOS data</Link>
                  <span className="text-ink-3"> (only your health data; the rest of your account stays)</span>
                </li>
                <li>
                  <Link href="/settings/delete-account" className="text-danger underline" data-testid="account-delete">Delete my account</Link>
                </li>
              </>
            )}
          </ul>
        </Card>
        {v.team ? null : (
          <Card id="photo" className="min-w-0" title="Your photo" action={<span className="text-xs text-ink-3" data-testid="photo-source">{v.membership.headshotSource === "upload" ? "your own" : v.membership.headshotSource === "import" ? "from your coach's records" : v.membership.headshotSource === "removed" ? "removed" : "none yet"}</span>}>
            {photoNotice === "removed" ? <p className="mb-2 rounded-lg bg-surface-2 p-2 text-sm" role="status" data-testid="photo-removed">Removed. Your coach&apos;s import won&apos;t put it back.</p> : null}
            <div className="flex items-start gap-4">
              <MemberAvatar membershipId={v.membership.id} hasPhoto={hasHeadshot(v.membership)} emoji={v.user.avatarEmoji} size={72} version={v.membership.headshotUpdatedAt} name={v.user.name} />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs text-ink-3">Shown to you and your coach inside HelixOS. A photo you add replaces the one from your coach&apos;s records, and their import never overwrites it. Using it on a published graphic is your choice, on your Brand kit.</p>
                {v.switchedInto ? <p className="text-xs text-ink-3">The client adds their own photo.</p> : <HeadshotUpload media={ownMedia} replace={hasHeadshot(v.membership)} />}
                {hasHeadshot(v.membership) && !v.switchedInto ? (
                  <form action={removeMyHeadshotAction}>
                    <SubmitButton className="btn btn-ghost btn-xs text-danger" pendingText="Removing…" data-testid="photo-remove">Remove my photo</SubmitButton>
                  </form>
                ) : null}
                {v.workspace.colosseumOn && !v.switchedInto ? (
                  <div className="space-y-2 border-t pt-2" data-testid="arena-settings">
                    <form action={setArenaPhotoAction} className="flex flex-wrap items-center gap-2 text-sm">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="arenaPhoto" defaultChecked={v.membership.arenaPhoto} data-testid="arena-photo" /> Show my photo in the Colosseum
                      </label>
                      <SubmitButton className="btn btn-soft btn-xs" pendingText="Saving…" data-testid="arena-photo-save">Save</SubmitButton>
                    </form>
                    <form action={setArenaHiddenAction} className="flex flex-wrap items-center gap-2 text-sm">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="arenaHidden" defaultChecked={v.membership.arenaHidden} data-testid="arena-hidden" /> Hide me from the arena and the standings
                      </label>
                      <SubmitButton className="btn btn-soft btn-xs" pendingText="Saving…" data-testid="arena-hidden-save">Save</SubmitButton>
                    </form>
                    <p className="text-xs text-ink-3">Off, the Colosseum shows your initials. Only you can turn your photo on there; your coach can&apos;t.</p>
                  </div>
                ) : null}
              </div>
            </div>
          </Card>
        )}
        {v.team ? null : (
          <Card id="sounds" className="min-w-0" title="Sounds">
            {/* The living scenes' sounds (H-400): one switch for the crowd, the applause and the fire, on by default, the member's own. */}
            {v.switchedInto ? (
              <p className="text-sm text-ink-3" data-testid="sounds-theirs">{v.membership.soundsOn ? "On." : "Off."} The client sets this.</p>
            ) : (
              <form action={setSoundsOnAction} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="soundsOn" defaultChecked={v.membership.soundsOn} data-testid="sounds-on" /> Play the sounds: the crowd at a rank-up, the arena at the evening close, the fire under the welcome
                </label>
                <SubmitButton className="btn btn-soft btn-xs" pendingText="Saving…" data-testid="sounds-save">Save</SubmitButton>
              </form>
            )}
            <p className="mt-2 text-xs text-ink-3">Nothing plays until you have tapped or typed on the page, and nothing plays when your device asks for reduced motion.</p>
          </Card>
        )}
        <Card id="you" className="min-w-0" title="You">
          <form action={updateProfileAction} className="space-y-3">
            <div className="grid grid-cols-[4rem_1fr] gap-3">
              {/* Not a Field: its label would re-activate the button on every tap inside the picker's grid. */}
              <div className="block">
                <span className="label" id="emoji-label">Emoji</span>
                <EmojiPicker current={v.user.avatarEmoji || "🧭"} />
              </div>
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
            <Field label="My work days" hint="Every day: a day with nothing done breaks the streak, weekends too, and an active Saturday or Sunday pays +40. Monday to Friday: weekends never count, either way.">
              <select className="field" name="workDays" defaultValue={v.membership.workDays} data-testid="work-days">
                <option value="all">Every day</option>
                <option value="weekdays">Monday to Friday</option>
              </select>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="scoreboardEmail" defaultChecked={v.membership.scoreboardEmail} data-testid="scoreboard-email" />{" "}
              {v.role === "coach" ? "Send me the Monday roster of my clients' week" : "Send me the Monday scoreboard"}
            </label>
            <SubmitButton className="btn btn-primary" pendingText="Saving…">
              Save
            </SubmitButton>
          </form>
          {/* H-290: the way to the council page from here too. */}
          <p className="mt-3 text-sm text-ink-2" data-testid="board-seats-line">
            Board seats: the four who sit with Danno on every decision.{" "}
            <Link href="/my-board/council" className="underline">
              Choose your council
            </Link>
          </p>
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
            {botError ? (
              <p className="rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="bot-facts-error">
                {botError}
              </p>
            ) : null}
            <Field label="Booking link" hint="The link your bot sends when someone wants to book a call.">
              <input className="field" name="bookingUrl" type="url" maxLength={500} placeholder="https://" defaultValue={v.membership.bookingUrl ?? ""} data-testid="booking-url" />
            </Field>
            <Field label="What to expect when you book" hint="A few lines your bot can say about the call: how long, what you'll cover, what to bring.">
              <textarea className="field" name="bookingExpect" rows={3} maxLength={500} defaultValue={v.membership.bookingExpect ?? ""} data-testid="booking-expect" />
            </Field>
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
        {v.switchedInto || v.team ? null : <BotConnectionCard workspaceId={v.workspace.id} userId={v.user.id} membershipId={v.membership.id} tz={v.membership.timezone ?? v.workspace.timezone} />}
        {v.switchedInto || v.team || !mfAvailable(v.membership) ? null : (
          <Card id="magic-funnel" className="scroll-mt-20" title="🪄 Magic funnel">
            {mfError ? (
              <p className="mb-2 rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="mf-domains-error">
                {mfError}
              </p>
            ) : mfNotice === "saved" ? (
              <p className="mb-2 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="mf-domains-saved">
                Saved.
              </p>
            ) : null}
            <form action={saveMfDomainsAction} className="space-y-3">
              <Field label="Your funnel domains" hint="The hosts your GoHighLevel registration pages are on, like go.yourdomain.com, one a line. Only these pages can read a person's Magic funnel page.">
                <textarea className="field" name="domains" rows={3} defaultValue={v.membership.mfDomains.join("\n")} data-testid="mf-domains" />
              </Field>
              {v.membership.role === "coach" ? (
                <Field label="Pages a day, at most" hint="Past it, pages use your default copy until tomorrow.">
                  <input className="field tabular" name="dailyCap" type="number" min={0} max={5000} defaultValue={v.membership.mfDailyCap} data-testid="mf-daily-cap" />
                </Field>
              ) : (
                <p className="text-xs text-ink-3">Up to {v.membership.mfDailyCap} pages a day; your coach sets it.</p>
              )}
              <SubmitButton className="btn btn-ghost btn-sm" pendingText="Saving…" data-testid="mf-domains-save">
                Save
              </SubmitButton>
            </form>
          </Card>
        )}
        {/* HumanOS (rev 320/322): the member's own switch, off by default. Off hides the group and keeps the data; on shows it as it was. */}
        <Card id="humanos" title="HumanOS">
          {humanosNotice === "deleted" ? <p className="mb-2 rounded-lg bg-surface-2 p-2 text-sm" role="status" data-testid="humanos-deleted">Your HumanOS data was deleted. Everything else is as it was.</p> : null}
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
        {/* My Board (rev 664 §9): the same Board in Claude, built from Danno's current principles. */}
        <Card id="board-in-claude" title="Use your Board in Claude">
          <p className="text-sm text-ink-2">Your Board&apos;s five advisors as a Claude skill, for deciding things away from HelixOS. It carries Danno&apos;s current principles and nothing of your own data. Connect HelixOS to Claude as well and the Board there reads your HelixOS too.</p>
          <a href="/api/board/skill" className="btn btn-primary btn-sm mt-3 inline-block" download data-testid="board-skill-download">
            Download your Board for Claude
          </a>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm" data-testid="board-skill-steps">
            {SKILL_INSTALL_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
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
        {setupList}
        {goalCard}
        {leaderboard ? (
          <Card id="leaderboard" title="Loyalty leaderboard">
            <p className="text-sm" data-testid="leaderboard-state">
              Leaderboard: <strong>{leaderboard.keyEncrypted ? "connected" : leaderboard.exportJson ? "showing your pasted export" : "not connected"}</strong>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <a href={`${appBase()}/lb/${leaderboard.slug}`} target="_blank" rel="noreferrer" className="min-w-0 break-all rounded bg-surface-2 px-2 py-1 underline" data-testid="leaderboard-page-link">{`${appBase()}/lb/${leaderboard.slug}`}</a>
              <CopyButton text={`${appBase()}/lb/${leaderboard.slug}`} label="Copy" className="btn btn-ghost btn-xs" />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <code className="min-w-0 break-all rounded bg-surface-2 px-2 py-1" data-testid="leaderboard-feed-link">{`${appBase()}/api/public/leaderboard/${leaderboard.slug}`}</code>
              <CopyButton text={`${appBase()}/api/public/leaderboard/${leaderboard.slug}`} label="Copy" className="btn btn-ghost btn-xs" />
            </div>
            <p className="mt-2 text-xs text-ink-3">
              Your page shows first names and initials, points and tiers, nothing else. Its words, tiers, rewards, a pasted export and the hide list are on{" "}
              <Link href="/loyalty" className="underline" data-testid="leaderboard-edit-link">Loyalty leaderboard</Link>. Your coach sets up the connection.
            </p>
          </Card>
        ) : null}
        <Card id="connected-apps" title="Connected apps">
          {/* The MCP server (rev 224): the apps this member let act as them, and the way to cut each one. */}
          {appsNote ? <p className="mb-2 text-sm text-good" data-testid="apps-note">{appsNote}</p> : null}
          {v.role === "coach" ? (
            <form action={setColosseumOnAction} className="mb-3 flex flex-wrap items-center gap-3 text-sm" data-testid="colosseum-on" data-on={v.workspace.colosseumOn ? "1" : "0"}>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="colosseumOn" defaultChecked={v.workspace.colosseumOn} data-testid="colosseum-on-toggle" /> The Colosseum is on for your workspace
              </label>
              <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="colosseum-on-save">
                Save
              </SubmitButton>
            </form>
          ) : null}
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
        <Card id="forum" className="scroll-mt-20" title="🏛️ The Forum" action={<Link href="/forum" className="text-xs text-ink-2 hover:underline">Your Forum →</Link>}>
          <ForumWebhookCard url={`${appBase()}/api/forum/report`} made={forumHook.webhookCreatedAt ? formatDateTime(forumHook.webhookCreatedAt, v.tz, { zone: true }) : null} usedAt={forumHook.webhookUsedAt ? formatDateTime(forumHook.webhookUsedAt, v.tz, { zone: true }) : null} canChange={!v.switchedInto && !v.team} />
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
        <Card id="team" title="Team" action={seats ? <span className="text-xs text-ink-3" data-testid="team-seats">{seatsLine(seats)}</span> : null}>
          <p className="mb-3 text-sm text-ink-2">Invite a VA or a team member into your HelixOS with their own login. They can work in your content, DMs, tasks, webinars and contacts, and nothing else: not your day, your HumanOS, your connections, your billing or this team. Every change they make is shown here as theirs.</p>
          {teamNote ? <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-sm" role="status" data-testid="team-note">{teamNote}</p> : null}
          {inviteCode ? (
            <div className="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-sm" data-testid="team-invite-link">
              <p className="mb-1">Send this link to them yourself. It works once, for {TEAM_INVITE_DAYS} days, and won&apos;t be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="field truncate" data-testid="team-invite-url">{`${appUrl}/join/team/${inviteCode}`}</code>
                <CopyButton text={`${appUrl}/join/team/${inviteCode}`} />
              </div>
            </div>
          ) : null}
          {seats && seats.left > 0 ? (
            <form action={createTeamInviteAction} className="mb-3 flex flex-wrap items-end gap-2" data-testid="team-invite-form">
              <Field label="Who is it for (optional)">
                <input className="field" name="label" maxLength={80} placeholder="Sam, our VA" />
              </Field>
              <SubmitButton className="btn btn-primary btn-sm" pendingText="Making the link…" data-testid="team-invite">
                Invite team member
              </SubmitButton>
            </form>
          ) : seats ? (
            <p className="mb-3 text-sm text-ink-3" data-testid="team-full">All {seats.cap} seats are taken or spoken for. Remove someone or cancel an invite to make room, or ask your coach for more seats.</p>
          ) : null}
          {team.length ? (
            <ul className="divide-y divide-line text-sm" data-testid="team-members">
              {team.map((t) => (
                <li key={t.member.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="team-member">
                  <span>
                    <span className="font-medium">{t.name}</span> <span className="text-ink-3">· {t.email}</span>
                    <span className="block text-xs text-ink-3">
                      added by {t.addedByName} on {formatDate(t.member.createdAt.slice(0, 10))} · last active {lastActiveWords(t.member.lastActiveAt)}
                    </span>
                  </span>
                  <form action={removeTeamMemberAction}>
                    <input type="hidden" name="teamMemberId" value={t.member.id} />
                    <ConfirmDelete verb="Remove" what={`${t.name} from your team`} undo="Their access ends on their next request. What they made here stays yours." label="Remove" className="btn btn-ghost btn-xs" testId="team-remove" />
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3" data-testid="team-empty">Nobody on your team yet.</p>
          )}
          {invites.length ? (
            <ul className="mt-3 space-y-1 text-sm" data-testid="team-invites">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="team-invite-open">
                  <span>
                    Invite{i.label ? ` for ${i.label}` : ""} <span className="text-ink-3">· open until {formatDateTime(i.expiresAt, v.tz)}</span>
                  </span>
                  <form action={revokeTeamInviteAction}>
                    <input type="hidden" name="inviteId" value={i.id} />
                    <SubmitButton className="btn btn-ghost btn-xs" pendingText="Cancelling…" data-testid="team-revoke">
                      Cancel invite
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-ink-2">Changes by your team ({teamChangeRows.length})</summary>
            {teamChangeRows.length ? (
              <ul className="mt-2 space-y-1" data-testid="team-changes">
                {teamChangeRows.map((c) => (
                  <li key={c.id} data-testid="team-change">
                    <span className="font-medium">{c.action}</span>
                    {c.item ? <> · &ldquo;{c.item}&rdquo;</> : null} · on {c.page} · by {teamNames.get(c.teamUserId) ?? "a team member"} · <span className="text-ink-3">{formatDateTime(c.createdAt.replace(" ", "T") + "Z", v.tz)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-ink-3">Nothing yet.</p>
            )}
          </details>
        </Card>
        <Card id="brand-kit" className="scroll-mt-20" title="Brand kit" action={savedKit ? <span className="text-xs text-ink-3">ink on ground {contrastRatio(savedKit.ground, savedKit.ink)}:1</span> : null}>
          <div data-testid="brand-card" data-status={kitStatus(savedKit)} />
          <p className="mb-3 text-sm text-ink-2">Your own colours, faces and logo: your decks render in these and in nobody else&apos;s. Six-digit hex, no #. A pair that cannot read on a slide is refused here, not discovered on screen.</p>
          {savedKit && brandKitWarnings(savedKit).length ? (
            <ul className="mb-3 list-disc rounded-lg bg-warn-soft p-2 pl-6 text-sm" data-testid="brand-warnings">
              {brandKitWarnings(savedKit).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : null}
          {!savedKit ? (
            <p className="mb-3 rounded-lg border border-accent bg-accent-soft p-2 text-sm" data-testid="brand-starter">
              <strong>House starter kit — replace with your own.</strong> Your decks use these colours and faces until you save your own. Change any of them, give the kit your business name, pick your logo, and save.
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
            <div className="sm:col-span-2 border-t pt-3">
              <div className="text-sm font-semibold">The graphic&apos;s badge</div>
              <p className="text-xs text-ink-3">On every graphic Make the graphic draws (Ladders): your avatar, name, verified tick and @handle under the headline, and the gold of the one phrase.</p>
            </div>
            <Field label="Display name">
              <input className="field" name="graphicDisplayName" defaultValue={brandKit?.graphicDisplayName ?? ""} placeholder={v.user.name} data-testid="brand-graphic-name" />
            </Field>
            <Field label="@handle">
              <input className="field" name="graphicHandle" defaultValue={brandKit?.graphicHandle ?? ""} placeholder="@yourhandle" data-testid="brand-graphic-handle" />
            </Field>
            <Field label="Avatar" hint="a photo or logo from your Images; a framed Business Page photo needs no extra ring">
              <select className="field" name="graphicAvatarImageId" defaultValue={brandKit?.graphicAvatarImageId ?? ""} data-testid="brand-graphic-avatar">
                <option value="">None</option>
                {avatars.map((a) => (
                  <option key={a.id} value={a.id}>{a.caption?.trim() || a.kind} · {a.width}×{a.height}</option>
                ))}
              </select>
            </Field>
            {hasHeadshot(v.membership) ? (
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="graphicUseHeadshot" value="1" defaultChecked={brandKit?.graphicUseHeadshot ?? false} disabled={Boolean(v.switchedInto)} className="mt-1" data-testid="brand-use-headshot" />
                <span>
                  Use my profile photo as the badge
                  <span className="block text-xs text-ink-3">When no avatar is picked above, your graphics show your profile photo. Your yes, not your coach&apos;s: a photo from their records is never published without it.</span>
                </span>
              </label>
            ) : null}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="graphicVerified" value="1" defaultChecked={brandKit?.graphicVerified ?? false} className="mt-1" data-testid="brand-graphic-verified" />
              <span>
                Verified
                <span className="block text-xs text-ink-3">The blue tick beside your name, only if your page has one.</span>
              </span>
            </label>
            <Field label="Gold, from" hint="hex; empty means Danno's Canva gold">
              <input className="field font-mono" name="graphicGoldFrom" defaultValue={brandKit?.graphicGoldFrom ?? ""} maxLength={7} placeholder="DDA338" />
            </Field>
            <Field label="Gold, to">
              <input className="field font-mono" name="graphicGoldTo" defaultValue={brandKit?.graphicGoldTo ?? ""} maxLength={7} placeholder="C5801F" />
            </Field>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="aiBackgrounds" value="1" defaultChecked={brandKit?.aiBackgrounds ?? true} className="mt-1" data-testid="brand-ai-backgrounds" />
              <span>
                Allow AI backgrounds
                <span className="block text-xs text-ink-3">When no photo of yours fits a graphic, a background scene can be made with your own AI key. Backgrounds only: a person in a graphic is always your own real photo. Off, your photos or a plain ground.</span>
              </span>
            </label>
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
                <Field label="HelixOS Airtable base ID" hint="The base the Pathway, curriculum and DM templates are refreshed from.">
                  <input className="field" name="airtableBaseId" defaultValue={v.workspace.airtableBaseId ?? ""} placeholder="appXXXXXXXXXXXXXX" />
                </Field>
                <fieldset className="space-y-2" data-testid="platform-links">
                  <legend className="label">Platforms menu links</legend>
                  <p className="text-xs text-ink-3">Where the Platforms section of everyone&apos;s menu points. Leave one blank for the address shown; Community appears once it has a link (a client&apos;s own community link on Community wins for them).</p>
                  {PLATFORMS.map((p) => (
                    <label key={p.key} className="block text-sm">
                      <span className="text-xs text-ink-2">
                        {p.icon} {p.label}
                      </span>
                      <input className="field" name={`platform_${p.key}`} type="url" defaultValue={v.workspace.platformLinks[p.key] ?? ""} placeholder={p.href || "https://"} data-testid={`platform-${p.key}`} />
                    </label>
                  ))}
                </fieldset>
                <SubmitButton className="btn btn-primary" pendingText="Saving…">
                  Save workspace
                </SubmitButton>
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
      {/* The version this deploy is (rev 193), linking to What's new. */}
      <p className="mt-6 text-center text-xs text-ink-3">
        <Link href="/whats-new" className="hover:text-ink" data-testid="settings-version">
          {APP_VERSION}
        </Link>
      </p>
    </>
  );
}
