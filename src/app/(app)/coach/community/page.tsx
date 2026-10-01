import Link from "next/link";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { connectionFor, probeCommunityScopes } from "@/lib/ghl";
import { coachTz, settingsFor } from "@/lib/community";
import { checkCommunityPostAction, postCommunityNowAction, resolveCommunityPostAction, refreshCommunityChannelsAction, resumeCommunityAction, saveCommunitySettingsAction, saveNextMondayAction, saveNextMonthAction, sendCommunityTestAction, setCommunityLinkAction, setMonthLinkAction } from "@/lib/actions/community";
import { DEFAULT_POST_TIME, mondayDue, mondayText, mondayTitle, monthDue, monthText, monthTitle, upcomingMonth, upcomingWeek } from "@/lib/engine/community";
import { monthLabel } from "@/lib/engine/feedback";
import { ChannelPattern } from "@/components/channel-pattern";
import { formatDate, formatDateTime, nowWallInTz } from "@/lib/dates";
import type { CommunityPost } from "@/db/schema";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Community posts" };

const TONE = { scheduled: "neutral", sent: "accent", posted: "good", failed: "danger", skipped: "warn", unknown: "warn" } as const;
const WORD = { scheduled: "scheduled", sent: "on its way", posted: "posted", failed: "failed", skipped: "skipped", unknown: "unknown: check the community" } as const;

/**
 * The coach's community connection (handoff revs 150 to 154): where and when the Monday post goes, a test post that shows the
 * real result, next Monday's post before it goes out (edit or skip), and every post HelixOS has sent, with its status, reason,
 * link and that week's numbers. The first-of-the-month post (1 Oct) sits beside it: its own switch, time and text, next
 * month's before it goes out, a pasted link for a month posted by hand, and its own log with the month's numbers.
 */
export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const [s, conn] = await Promise.all([settingsFor(v.workspace.id), connectionFor(v.user.id)]);
  const tz = s ? await coachTz(s) : v.tz;
  const nowTime = nowWallInTz(tz).slice(11, 16);
  const postTime = s?.postTime ?? DEFAULT_POST_TIME;
  const next = upcomingWeek(v.today, nowTime, postTime);
  const monthTime = s?.monthTime ?? DEFAULT_POST_TIME;
  const nextMonthOf = upcomingMonth(v.today, nowTime, monthTime);
  const thisMonthOf = v.today.slice(0, 7);
  const [posts, scopes, clients, library] = await Promise.all([
    db.query.communityPosts.findMany({ where: eq(schema.communityPosts.workspaceId, v.workspace.id), orderBy: [desc(schema.communityPosts.createdAt)], limit: 60 }),
    conn?.manualToken ? probeCommunityScopes(conn) : Promise.resolve([]),
    db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) }),
    // The coach's own Images library, for the graphic each post carries (rev 328).
    db.query.deckImages.findMany({ where: and(eq(schema.deckImages.workspaceId, v.workspace.id), eq(schema.deckImages.userId, v.user.id)), orderBy: [desc(schema.deckImages.createdAt)] }),
  ]);
  const mondays = posts.filter((p) => p.kind === "monday");
  const months = posts.filter((p) => p.kind === "month");
  const nextMonthRow = months.find((p) => p.monthOf === nextMonthOf);
  const thisMonthRow = months.find((p) => p.monthOf === thisMonthOf) ?? null;
  // This month's post is missing when the 1st's time has passed with nothing sent: Post now. A month HelixOS didn't send (off,
  // skipped, or posted by hand, as October's is) can take a pasted link, so the members' share points at it.
  const monthMissed = s?.channelAccountId && s.monthOn && monthDue(v.today, nowTime, monthTime) && (!thisMonthRow || thisMonthRow.status === "scheduled") ? thisMonthOf : null;
  const monthByHand = !thisMonthRow || ["scheduled", "skipped", "failed"].includes(thisMonthRow.status);
  const tests = posts.filter((p) => p.kind === "test").slice(0, 3);
  const nextRow = mondays.find((p) => p.weekOf === next);
  // This week's post is missing when its Monday time has passed with nothing sent: the coach sees it and can post it now.
  const thisWeek = mondays.find((p) => p.weekOf === v.today) ?? null;
  const missed = s?.channelAccountId && mondayDue(v.today, nowTime, postTime) && (!thisWeek || thisWeek.status === "scheduled") ? v.today : null;
  const weeks = [...new Set(mondays.filter((p) => p.weekOf && p.weekOf <= v.today).map((p) => p.weekOf!))];
  // Per week: how many members set their 3-1-3, how many tapped "Share to the thread", and who hasn't shared yet.
  const setCounts = new Map<string, number>();
  const shareCounts = new Map<string, number>();
  const notShared = new Map<string, string[]>();
  const clientNames = clients.length ? new Map((await db.query.users.findMany({ where: inArray(schema.users.id, clients.map((c) => c.userId)) })).map((u) => [u.id, u.name])) : new Map<string, string>();
  for (const w of weeks) {
    const [rows, shares] = await Promise.all([
      db.query.weeklyIntentions.findMany({ where: and(eq(schema.weeklyIntentions.workspaceId, v.workspace.id), eq(schema.weeklyIntentions.weekOf, w)) }),
      db.query.communityShares.findMany({ where: and(eq(schema.communityShares.workspaceId, v.workspace.id), eq(schema.communityShares.weekOf, w)) }),
    ]);
    setCounts.set(w, rows.filter((r) => clients.some((c) => c.userId === r.userId)).length);
    const sharedIds = new Set(shares.map((x) => x.userId));
    shareCounts.set(w, clients.filter((c) => sharedIds.has(c.userId)).length);
    notShared.set(w, clients.filter((c) => !sharedIds.has(c.userId)).map((c) => clientNames.get(c.userId) ?? "A member").sort());
  }
  // Per month (1 Oct): how many members set their month, how many shared it to the thread, and who hasn't.
  const monthSetCounts = new Map<string, number>();
  const monthShareCounts = new Map<string, number>();
  const monthNotShared = new Map<string, string[]>();
  for (const m of [...new Set(months.filter((p) => p.monthOf && p.monthOf <= thisMonthOf).map((p) => p.monthOf!))]) {
    const [rows, shares] = await Promise.all([
      db.query.monthlyIntentions.findMany({ where: and(eq(schema.monthlyIntentions.workspaceId, v.workspace.id), eq(schema.monthlyIntentions.month, m)) }),
      db.query.communityShares.findMany({ where: and(eq(schema.communityShares.workspaceId, v.workspace.id), eq(schema.communityShares.monthOf, m)) }),
    ]);
    monthSetCounts.set(m, rows.filter((r) => clients.some((c) => c.userId === r.userId)).length);
    const sharedIds = new Set(shares.map((x) => x.userId));
    monthShareCounts.set(m, clients.filter((c) => sharedIds.has(c.userId)).length);
    monthNotShared.set(m, clients.filter((c) => !sharedIds.has(c.userId)).map((c) => clientNames.get(c.userId) ?? "A member").sort());
  }
  const channels = (conn?.accounts ?? []).slice().sort((a, b) => Number(b.platform === "community") - Number(a.platform === "community"));
  const missing = scopes.filter((x) => x.state === "missing");

  return (
    <>
      <PageHeader title="Community posts" subtitle="The Monday 3-1-3 post and the first-of-the-month post in your GoHighLevel community, and what happened to each one." action={<Link href="/coach" className="btn btn-ghost btn-sm">Back</Link>} />
      {sp.saved ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="community-saved">{sp.saved}</p> : null}
      {sp.error ? <p className="mb-3 rounded-lg bg-danger-soft p-2 text-sm" role="alert" data-testid="community-error">{sp.error}</p> : null}
      {s?.pausedReason ? (
        <div className="mb-4 rounded-lg bg-danger-soft p-3 text-sm" role="alert" data-testid="community-paused">
          <p>{s.pausedReason}</p>
          <form action={resumeCommunityAction} className="mt-2">
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Resuming…" data-testid="community-resume">Resume</SubmitButton>
          </form>
        </div>
      ) : null}

      <Card id="setup" title="Setup" className="mb-5">
        {!conn ? (
          <p className="text-sm text-ink-2" data-testid="community-no-connection">
            Connect your GoHighLevel sub-account first, on <Link className="underline" href="/settings#publishing">Settings → Publishing</Link>. The posts go out through your Social Planner, from your team account.
          </p>
        ) : (
          <>
            <ul className="mb-3 space-y-1 text-sm" data-testid="community-scopes">
              {scopes.map((x) => (
                <li key={x.scope} data-scope={x.scope} data-state={x.state}>
                  {x.state === "ok" ? "✓" : x.state === "missing" ? "✗" : "·"} <code>{x.scope}</code> <span className="text-ink-3">{x.state === "ok" ? "granted" : x.state === "missing" ? "missing" : (x.note ?? "not checked")}</span>
                </li>
              ))}
            </ul>
            {missing.length ? (
              <p className="mb-3 rounded-lg bg-warn-soft p-2 text-sm" data-testid="community-scopes-missing">
                Your token is missing {missing.map((m) => m.scope).join(" and ")}. In GoHighLevel, edit the Private Integration, tick {missing.length > 1 ? "them" : "it"}, and paste the new token on Settings → Publishing.
              </p>
            ) : null}
            <form action={saveCommunitySettingsAction} className="space-y-3">
              <label className="block text-sm font-medium">
                The Intentions channel
                <select className="field mt-1" name="channel" defaultValue={s?.channelAccountId ?? ""} data-testid="community-channel">
                  <option value="">Pick a channel</option>
                  {channels.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.platform || "account"}
                      {a.type ? `, ${a.type}` : ""})
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-ink-3">Connect the community once in GoHighLevel under Marketing → Social Planner → Settings → Communities, then press Check again.</span>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="mondayOn" defaultChecked={s?.mondayOn ?? false} data-testid="community-monday-on" /> Post the 3-1-3 every Monday
                </label>
                {/* Rev 187: on by default. Only the Monday post notifies; a test post never does. */}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="mondayNotify" defaultChecked={s?.mondayNotify ?? true} data-testid="community-monday-notify" /> Notify all members when it goes out
                </label>
                <label className="block text-sm font-medium">
                  At ({tz})
                  <input className="field mt-1" name="postTime" defaultValue={postTime} placeholder="08:00" data-testid="community-time" />
                </label>
              </div>
              <label className="block text-sm font-medium">
                The Monday text
                <textarea className="field mt-1" name="mondayText" rows={6} defaultValue={mondayText(s?.mondayText)} data-testid="community-text" />
                <span className="mt-1 block text-xs text-ink-3">The title is set each week: &ldquo;{mondayTitle(next)}&rdquo;.</span>
              </label>
              <GraphicPicker name="mondayImageId" label="Graphic for the Monday post (optional)" value={s?.mondayImageId ?? null} library={library} testid="community-monday-image" />
              {/* The first-of-the-month post (1 Oct): the same channel and Posted as, its own switch, time and text. */}
              <fieldset className="min-w-0 space-y-3 rounded-lg border p-3" data-testid="community-month-setup">
                <legend className="px-1 text-sm font-semibold">The first of the month</legend>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="monthOn" defaultChecked={s?.monthOn ?? false} data-testid="community-month-on" /> Post the month&apos;s intentions on the 1st
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="monthNotify" defaultChecked={s?.monthNotify ?? true} data-testid="community-month-notify" /> Notify all members when it goes out
                  </label>
                  <label className="block text-sm font-medium">
                    At ({tz})
                    <input className="field mt-1" name="monthTime" defaultValue={monthTime} placeholder="08:00" data-testid="community-month-time" />
                  </label>
                </div>
                <label className="block text-sm font-medium">
                  The month text
                  <textarea className="field mt-1" name="monthText" rows={8} defaultValue={monthText(s?.monthText)} data-testid="community-month-text" />
                  <span className="mt-1 block text-xs text-ink-3">The title is set each month: &ldquo;{monthTitle(nextMonthOf)}&rdquo;.</span>
                </label>
                <GraphicPicker name="monthImageId" label="Graphic for the month post" value={s?.monthImageId ?? null} library={library} testid="community-month-image" />
              </fieldset>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-sm font-medium">
                  Posted as (community member contact ID)
                  <input className="field mt-1" name="postAsId" defaultValue={s?.postAsId ?? ""} placeholder="The contact ID on your community profile" data-testid="community-post-as-id" />
                  <span className="mt-1 block text-xs text-ink-3">Your own community profile&apos;s contact ID. A GoHighLevel staff user ID never works here. A team member only, never a client.</span>
                </label>
                <label className="block text-sm font-medium">
                  Name shown
                  <input className="field mt-1" name="postAsName" defaultValue={s?.postAsName ?? ""} placeholder={v.user.name} data-testid="community-post-as-name" />
                </label>
              </div>
              <label className="block text-sm font-medium">
                Link pattern (optional)
                <ChannelPattern patterns={{ ...(s?.linkPattern && s.channelAccountId ? { [s.channelAccountId]: s.linkPattern } : {}), ...(s?.linkPatterns ?? {}) }} channel={s?.channelAccountId ?? ""} />
                <span className="mt-1 block text-xs text-ink-3">For the channel picked above: each channel has its own address. Copy a published post&apos;s link from that channel and put {"{postId}"} where its id is (the community&apos;s post id). Until then, paste each week&apos;s link below.</span>
                {/* Which channels have one (rev 174), so a pattern learned from a pasted link can be seen on the right channel. */}
                {Object.keys(s?.linkPatterns ?? {}).length ? (
                  <span className="mt-1 block text-xs text-ink-2" data-testid="community-patterns-saved">
                    Saved for: {Object.keys(s!.linkPatterns).map((id) => channels.find((c) => c.id === id)?.name ?? "a channel no longer connected").join(", ")}
                  </span>
                ) : null}
              </label>
              <div className="flex flex-wrap gap-2">
                <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" data-testid="community-save">Save</SubmitButton>
                <SubmitButton className="btn btn-ghost btn-sm" formAction={refreshCommunityChannelsAction} pendingText="Checking…" data-testid="community-refresh">Check again</SubmitButton>
              </div>
            </form>
          </>
        )}
      </Card>

      <Card id="test" title="Test post" className="mb-5">
        <p className="mb-3 text-sm text-ink-2">Sends &ldquo;HelixOS test, please ignore&rdquo; to the channel above: pick your hidden test channel first. It shows who GoHighLevel says it&apos;s from, and the post&apos;s id once published. Delete it in the community afterwards.</p>
        <div className="flex flex-wrap gap-2">
          <form action={sendCommunityTestAction}>
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Sending…" data-testid="community-test">Send a test post</SubmitButton>
          </form>
          {/* Rev 169: the Monday text itself, to see its layout in the test channel before the Monday post is on. */}
          <form action={sendCommunityTestAction}>
            <input type="hidden" name="kind" value="monday" />
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Sending…" data-testid="community-test-monday">Send the Monday text as a test</SubmitButton>
          </form>
          <form action={sendCommunityTestAction}>
            <input type="hidden" name="kind" value="month" />
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Sending…" data-testid="community-test-month">Send the month text as a test</SubmitButton>
          </form>
        </div>
        <p className="mt-2 text-xs text-ink-3">Tests go to the channel picked above and never notify anyone.</p>
        {tests.length ? (
          <ul className="mt-3 space-y-2 text-sm">
            {tests.map((t) => (
              <PostLine key={t.id} p={t} tz={tz} testid="community-test-result" />
            ))}
          </ul>
        ) : null}
      </Card>

      <Card id="next" title={`Next Monday: ${formatDate(next, { weekday: "short", month: "short", day: "numeric" })}`} className="mb-5" action={<Badge tone={nextRow?.status === "skipped" ? "warn" : s?.mondayOn ? "accent" : "neutral"}>{nextRow?.status === "skipped" ? "skipped" : s?.mondayOn ? `at ${postTime}` : "off"}</Badge>}>
        <div data-testid="community-next" data-week={next} data-state={nextRow?.status ?? "scheduled"}>
          <p className="text-sm font-semibold" data-testid="community-next-title">{mondayTitle(next)}</p>
          {nextRow && !["scheduled", "skipped"].includes(nextRow.status) ? (
            <p className="mt-2 text-sm text-ink-2">It has gone out. See the log below.</p>
          ) : (
            <form action={saveNextMondayAction} className="mt-2 space-y-2">
              <input type="hidden" name="weekOf" value={next} />
              <textarea className="field" name="body" rows={6} defaultValue={nextRow?.body ?? mondayText(s?.mondayText)} data-testid="community-next-body" />
              <div className="flex flex-wrap gap-2">
                <SubmitButton className="btn btn-ghost btn-sm" name="intent" value="save" pendingText="Saving…" data-testid="community-next-save">Save for this Monday</SubmitButton>
                {nextRow?.status === "skipped" ? (
                  <SubmitButton className="btn btn-ghost btn-sm" name="intent" value="unskip" pendingText="Saving…" data-testid="community-next-unskip">Post it after all</SubmitButton>
                ) : (
                  <SubmitButton className="btn btn-ghost btn-sm" name="intent" value="skip" pendingText="Saving…" data-testid="community-next-skip">Skip this week</SubmitButton>
                )}
              </div>
              {!s?.mondayOn ? <p className="text-xs text-ink-3">The Monday post is off: turn it on under Setup.</p> : null}
            </form>
          )}
        </div>
      </Card>

      <Card id="month" title={`First of the month: ${monthLabel(nextMonthOf)}`} className="mb-5" action={<Badge tone={nextMonthRow?.status === "skipped" ? "warn" : s?.monthOn ? "accent" : "neutral"}>{nextMonthRow?.status === "skipped" ? "skipped" : s?.monthOn ? `at ${monthTime}` : "off"}</Badge>}>
        <div data-testid="community-month-next" data-month={nextMonthOf} data-state={nextMonthRow?.status ?? "scheduled"}>
          <p className="text-sm font-semibold" data-testid="community-month-next-title">{monthTitle(nextMonthOf)}</p>
          {nextMonthRow && !["scheduled", "skipped"].includes(nextMonthRow.status) ? (
            <p className="mt-2 text-sm text-ink-2">It has gone out. See the log below.</p>
          ) : (
            <form action={saveNextMonthAction} className="mt-2 space-y-2">
              <input type="hidden" name="monthOf" value={nextMonthOf} />
              <textarea className="field" name="body" rows={8} defaultValue={nextMonthRow?.body ?? monthText(s?.monthText)} data-testid="community-month-next-body" />
              <div className="flex flex-wrap gap-2">
                <SubmitButton className="btn btn-ghost btn-sm" name="intent" value="save" pendingText="Saving…" data-testid="community-month-next-save">Save for that 1st</SubmitButton>
                {nextMonthRow?.status === "skipped" ? (
                  <SubmitButton className="btn btn-ghost btn-sm" name="intent" value="unskip" pendingText="Saving…" data-testid="community-month-next-unskip">Post it after all</SubmitButton>
                ) : (
                  <SubmitButton className="btn btn-ghost btn-sm" name="intent" value="skip" pendingText="Saving…" data-testid="community-month-next-skip">Skip that month</SubmitButton>
                )}
              </div>
              {!s?.monthOn ? <p className="text-xs text-ink-3">The month post is off: turn it on under Setup.</p> : null}
            </form>
          )}
        </div>
        {monthMissed ? (
          <div className="mt-3 rounded-lg bg-warn-soft p-2 text-sm" data-testid="community-month-missed">
            {monthTitle(monthMissed)} hasn&apos;t gone out.
            <form action={postCommunityNowAction} className="mt-2">
              <input type="hidden" name="monthOf" value={monthMissed} />
              <SubmitButton className="btn btn-primary btn-sm" pendingText="Posting…" data-testid="community-month-post-now">Post now</SubmitButton>
            </form>
          </div>
        ) : null}
        {/* A month posted by hand (October's, 1 Oct): its pasted link makes the row, published, so the members' share points at it. */}
        {monthByHand ? (
          <form action={setMonthLinkAction} className="mt-3 rounded-lg border p-3" data-testid="community-month-by-hand" data-month={thisMonthOf}>
            <p className="mb-2 text-sm font-medium">Posted {monthLabel(thisMonthOf)}&apos;s yourself? Paste its link, and members can share their month to it.</p>
            <input type="hidden" name="monthOf" value={thisMonthOf} />
            <div className="flex flex-wrap items-center gap-2">
              <input className="field max-w-md" name="link" placeholder="The post's link from the community" data-testid="community-month-link" />
              <SubmitButton className="btn btn-ghost btn-sm" pendingText="Saving…" data-testid="community-month-link-save">Save link</SubmitButton>
            </div>
          </form>
        ) : null}
        {months.filter((p) => p.status !== "scheduled" || (p.monthOf ?? "") < thisMonthOf).length ? (
          <ul className="mt-4 divide-y text-sm" data-testid="community-month-log">
            {months
              .filter((p) => p.status !== "scheduled" || (p.monthOf ?? "") < thisMonthOf)
              .map((p) => (
                <li key={p.id} className="py-3" data-testid="community-month-row" data-month={p.monthOf ?? ""} data-state={p.status}>
                  <PostLine p={p} tz={tz} />
                  {p.monthOf && p.monthOf <= thisMonthOf ? (
                    <div className="mt-1 text-xs text-ink-3">
                      <p data-testid="community-month-counts">
                        months set: {monthSetCounts.get(p.monthOf) ?? 0} of {clients.length} · shared to the thread: <span data-testid="community-month-shares">{monthShareCounts.get(p.monthOf) ?? 0}</span>
                      </p>
                      {(monthNotShared.get(p.monthOf) ?? []).length ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer">Not shared yet ({(monthNotShared.get(p.monthOf) ?? []).length})</summary>
                          <p className="mt-1 text-ink-2" data-testid="community-month-not-shared">{(monthNotShared.get(p.monthOf) ?? []).join(", ")}</p>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                  {p.status === "failed" ? (
                    <form action={postCommunityNowAction} className="mt-2">
                      <input type="hidden" name="monthOf" value={p.monthOf ?? ""} />
                      <SubmitButton className="btn btn-ghost btn-sm" pendingText="Posting…" data-testid="community-month-retry">Post now</SubmitButton>
                    </form>
                  ) : null}
                  <form action={setCommunityLinkAction} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="postId" value={p.id} />
                    <input className="field max-w-md" name="link" defaultValue={p.link ?? ""} placeholder="Paste the post's link from the community" data-testid="community-month-row-link" />
                    <SubmitButton className="btn btn-ghost btn-sm" pendingText="Saving…" data-testid="community-month-row-link-save">Save link</SubmitButton>
                    {p.status !== "posted" ? <span className="text-xs text-ink-3">If it&apos;s in the community, paste its link: that marks it published.</span> : null}
                  </form>
                </li>
              ))}
          </ul>
        ) : null}
      </Card>

      <Card id="log" title="Every Monday post" action={<span className="text-xs text-ink-3">{clients.length} members</span>}>
        {missed ? (
          <div className="mb-3 rounded-lg bg-warn-soft p-2 text-sm" data-testid="community-missed">
            {mondayTitle(missed)} hasn&apos;t gone out.
            <form action={postCommunityNowAction} className="mt-2">
              <input type="hidden" name="weekOf" value={missed} />
              <SubmitButton className="btn btn-primary btn-sm" pendingText="Posting…" data-testid="community-post-now">Post now</SubmitButton>
            </form>
          </div>
        ) : null}
        {mondays.filter((p) => p.status !== "scheduled" || (p.weekOf ?? "") < v.today).length ? (
          <ul className="divide-y text-sm">
            {mondays
              .filter((p) => p.status !== "scheduled" || (p.weekOf ?? "") < v.today)
              .map((p) => (
                <li key={p.id} className="py-3" data-testid="community-log-row" data-week={p.weekOf ?? ""} data-state={p.status}>
                  <PostLine p={p} tz={tz} />
                  {p.weekOf && p.weekOf <= v.today ? (
                    <div className="mt-1 text-xs text-ink-3">
                      <p data-testid="community-week-counts">
                        3-1-3s set that week: {setCounts.get(p.weekOf) ?? 0} of {clients.length} · shared to the thread: <span data-testid="community-week-shares">{shareCounts.get(p.weekOf) ?? 0}</span>
                      </p>
                      {(notShared.get(p.weekOf) ?? []).length ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer">Not shared yet ({(notShared.get(p.weekOf) ?? []).length})</summary>
                          <p className="mt-1 text-ink-2" data-testid="community-not-shared">{(notShared.get(p.weekOf) ?? []).join(", ")}</p>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                  {p.status === "failed" ? (
                    <form action={postCommunityNowAction} className="mt-2">
                      <input type="hidden" name="weekOf" value={p.weekOf ?? ""} />
                      <SubmitButton className="btn btn-ghost btn-sm" pendingText="Posting…" data-testid="community-retry">Post now</SubmitButton>
                    </form>
                  ) : null}
                  {/* On every row (28 Sep, live): a post the coach can see in the community is published, whatever HelixOS said. */}
                  <form action={setCommunityLinkAction} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="postId" value={p.id} />
                    <input className="field max-w-md" name="link" defaultValue={p.link ?? ""} placeholder="Paste the post's link from the community" data-testid="community-link" />
                    <SubmitButton className="btn btn-ghost btn-sm" pendingText="Saving…" data-testid="community-link-save">Save link</SubmitButton>
                    {p.status !== "posted" ? <span className="text-xs text-ink-3">If it&apos;s in the community, paste its link: that marks it published.</span> : null}
                  </form>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">Nothing has gone out yet.</p>
        )}
      </Card>
    </>
  );
}

/**
 * The graphic a post goes out with (rev 328): one of the coach's own library images, square for the community. The library
 * is on the Images page; the planner gets a public copy when the post is sent.
 */
function GraphicPicker({ name, label, value, library, testid }: { name: string; label: string; value: string | null; library: { id: string; caption: string | null; kind: string; width: number; height: number }[]; testid: string }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <select className="field mt-1" name={name} defaultValue={value ?? ""} data-testid={testid}>
        <option value="">No graphic</option>
        {library.map((img) => (
          <option key={img.id} value={img.id}>
            {img.caption ? img.caption : img.kind} · {img.kind} · {img.width}×{img.height}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs text-ink-3">
        A square image (540 by 540) from your <Link className="underline" href="/images">Images</Link> library, sent at the bottom of the post. Make the month&apos;s in Canva and add it there first.
      </span>
    </label>
  );
}

/** One post: its title, status, reason, who it showed as, its ids and link, and a Check again while it's on its way. */
function PostLine({ p, tz, testid }: { p: CommunityPost; tz: string; testid?: string }) {
  return (
    <div data-testid={testid} data-state={p.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{p.title}</span>
        <Badge tone={TONE[p.status]}>{WORD[p.status]}</Badge>
        {p.sentAt ? <span className="text-xs text-ink-3">{formatDateTime(p.sentAt, tz)}</span> : null}
      </div>
      {p.error ? <p className="mt-1 text-danger" data-testid="community-post-error">{p.error}</p> : null}
      <p className="mt-1 text-xs text-ink-3">
        {p.authorShown ? <span data-testid="community-author">Shown as {p.authorShown}. </span> : null}
        {p.notifyAll ? <span data-testid="community-notified">Asked to notify all members. </span> : null}
        {p.ghlPostId ? <span>Planner id {p.ghlPostId}. </span> : null}
        {p.imageUrl ? (
          <a className="underline" href={p.imageUrl} target="_blank" rel="noreferrer" data-testid="community-post-graphic">
            With its graphic.{" "}
          </a>
        ) : null}
        {p.platformPostId ? <span data-testid="community-platform-id">Community id {p.platformPostId}. </span> : null}
        {p.link ? (
          <a className="underline" href={p.link} target="_blank" rel="noreferrer" data-testid="community-post-link">
            Open the post
          </a>
        ) : null}
      </p>
      {p.checkNote && p.status !== "posted" ? (
        <p className="mt-1 text-xs text-ink-3" data-testid="community-check-note">
          Last check: {p.checkNote}
        </p>
      ) : null}
      {p.status === "sent" || p.status === "unknown" ? (
        <div className="mt-1 flex flex-wrap gap-2">
          <form action={checkCommunityPostAction}>
            <input type="hidden" name="postId" value={p.id} />
            <SubmitButton className="btn btn-ghost btn-xs" pendingText="Checking…" data-testid="community-check">Check again</SubmitButton>
          </form>
          {p.status === "unknown"
            ? (["live", "not"] as const).map((outcome) => (
                <form key={outcome} action={resolveCommunityPostAction}>
                  <input type="hidden" name="postId" value={p.id} />
                  <input type="hidden" name="outcome" value={outcome} />
                  <SubmitButton className="btn btn-ghost btn-xs" pendingText="Saving…" data-testid={outcome === "live" ? "community-resolve-live" : "community-resolve-not"}>
                    {outcome === "live" ? "It's live" : "It didn't go out"}
                  </SubmitButton>
                </form>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
