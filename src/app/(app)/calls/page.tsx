import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { callsListedFor } from "@/lib/calls";
import { CALL_AUDIENCE_LABEL, LOCKED_LABEL, clockIn, dayHeading, joinState, type CallOccurrence } from "@/lib/engine/calls";
import { OOH_FRIDAYS, upcomingFridays } from "@/lib/engine/office-hours";
import { hostToday, oohSchedule, sessionStart } from "@/lib/engine/ooh-session";
import { oohAccessFor } from "@/lib/office-hours-access";
import { todayInTz, zoneName } from "@/lib/dates";
import type { ProgramCall } from "@/db/schema";
import { CallJoin } from "@/components/call-join";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Calls" };

const DAYS = 7;
type Item = { kind: "call" | "locked"; occ: CallOccurrence<ProgramCall> } | { kind: "ooh"; startIso: string };
const startOf = (i: Item) => (i.kind === "ooh" ? i.startIso : i.occ.startIso);

/**
 * Calls (H-820, plan H-828): the next seven days of the weekly calls the member's level can see, in their own time, with Join
 * (from 10 minutes before the start until two hours after it or the next call, H-836), the passcode, and Add to calendar for
 * each. No length or end time is shown: calls often run long. A live call sits at the top. An Accelerator member also sees
 * the Academy calls in their place, greyed and marked "Academy members", with nothing to press (H-865). Each Office Hours session in the
 * seven days is a row on its day, for a member who has Office Hours. The coach sees every call with who it
 * is for; a team member sees the owner's (their membership is the owner's, H-413). The stable address for the Wallet pass.
 */
export default async function CallsPage() {
  const v = await requireViewer({ team: "allow" });
  const now = new Date();
  const to = new Date(now.getTime() + DAYS * 86_400_000);
  const seer = { role: v.role, programTier: v.membership.programTier };
  // The calls this member's level can join (a team member's are the owner's), each live until two hours after its start or the
  // next of these calls, whichever is first (H-836); and, for an Accelerator member, the Academy calls listed greyed (H-865).
  const [listed, access] = await Promise.all([callsListedFor(v.workspace.id, now, to, seer), oohAccessFor(v)]);
  const items: Item[] = listed.map(({ occ, listed: how }) => ({ kind: how === "join" ? "call" : "locked", occ }));
  // Every Office Hours session in the seven days, as /office-hours counts them (H-457): the host's dates, on their own day and
  // time in the list, for a member who has Office Hours. It keeps its own page; the row links there.
  if (access.open) {
    const session = oohSchedule(v.workspace);
    for (const day of upcomingFridays(hostToday(session), OOH_FRIDAYS, session.weekday)) {
      const at = sessionStart(day, session);
      if (!at) break;
      if (at.getTime() + session.minutes * 60_000 <= now.getTime()) continue;
      if (at >= to) break;
      items.push({ kind: "ooh", startIso: at.toISOString() });
    }
  }
  items.sort((a, b) => startOf(a).localeCompare(startOf(b)));
  const live = items.filter((i) => i.kind === "call" && joinState(i.occ, now) === "live");
  const rest = items.filter((i) => !live.includes(i));
  const days = new Map<string, Item[]>();
  for (const i of rest) {
    const d = todayInTz(v.tz, new Date(startOf(i)));
    days.set(d, [...(days.get(d) ?? []), i]);
  }
  const passcode = v.workspace.callsPasscode;
  const row = (i: Item) => {
    if (i.kind === "ooh")
      return (
        <li key={`ooh-${i.startIso}`} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="calls-ooh" data-start={i.startIso}>
          <span className="min-w-0">
            <span className="tabular font-medium">{clockIn(i.startIso, v.tz)}</span> <span>🙋 Office Hours</span>
          </span>
          <Link href="/office-hours" className="btn btn-soft btn-sm min-h-11!" data-testid="calls-ooh-link">
            Office Hours →
          </Link>
        </li>
      );
    const o = i.occ;
    // A locked call (H-865): who it is for, greyed, and nothing to press: no Join, passcode, calendar file or sales line.
    if (i.kind === "locked")
      return (
        <li key={`locked-${o.call.id}-${o.startIso}`}>
          <div role="group" aria-disabled="true" aria-label={`${o.call.name}, ${LOCKED_LABEL[o.audience]}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-ink-3 opacity-60" data-testid="calls-locked" data-call={o.call.id} data-start={o.startIso} data-audience={o.audience}>
            <span className="min-w-0">
              <span className="tabular">{clockIn(o.startIso, v.tz)}</span> <span>{o.call.name}</span>
            </span>
            <span className="text-xs" data-testid="calls-locked-label">
              {LOCKED_LABEL[o.audience]}
            </span>
          </div>
        </li>
      );
    const state = joinState(o, now);
    return (
      <li key={`${o.call.id}-${o.startIso}`} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="calls-item" data-call={o.call.id} data-start={o.startIso} data-state={state} data-audience={o.audience}>
        <span className="min-w-0">
          <span className="tabular font-medium" data-testid="calls-item-time">
            {clockIn(o.startIso, v.tz)}
          </span>{" "}
          <span data-testid="calls-item-name">{o.call.name}</span>
          {v.role === "coach" ? (
            <span className="ml-1">
              <Badge tone={o.audience === "academy" ? "accent" : "neutral"}>
                <span data-testid="calls-item-audience">{CALL_AUDIENCE_LABEL[o.audience]}</span>
              </Badge>
            </span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <CallJoin startIso={o.startIso} liveEndIso={o.liveEndIso} link={o.link} tz={v.tz} initial={state} />
          <a href={`/calls/${o.call.id}/calendar`} className="btn btn-ghost btn-sm min-h-11" data-testid="calls-calendar">
            Add to calendar
          </a>
        </span>
      </li>
    );
  };
  return (
    <>
      <PageHeader title="Calls" subtitle={`This week's calls, in your time (${zoneName(v.tz, now)}).${v.team ? ` The calls ${v.team.ownerName.split(" ")[0]} can join.` : ""}`} />
      {passcode || v.workspace.callsLink ? (
        <p className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-3 text-sm" data-testid="calls-passcode">
          {v.workspace.callsLink ? (
            <span className="min-w-0 break-all">
              Every call opens at{" "}
              <a href={v.workspace.callsLink} target="_blank" rel="noopener noreferrer" className="underline">
                {v.workspace.callsLink.replace(/^https?:\/\//, "")}
              </a>
              {passcode ? "." : ""}
            </span>
          ) : null}
          {passcode ? (
            <>
              <span>
                Passcode: <b className="tabular" data-testid="calls-passcode-value">{passcode}</b>
              </span>
              <CopyButton text={passcode} className="btn btn-soft btn-sm min-h-11!" testId="calls-passcode-copy" />
            </>
          ) : null}
        </p>
      ) : null}
      {live.length ? (
        <Card className="mb-4 border-good" title={<span data-testid="calls-live-title">Live now</span>}>
          <ul className="divide-y" data-testid="calls-live">
            {live.map(row)}
          </ul>
        </Card>
      ) : null}
      {days.size ? (
        <div className="space-y-4" data-testid="calls-week">
          {[...days.entries()].map(([d, list]) => (
            <Card key={d} title={<span data-testid="calls-day">{dayHeading(d, v.today)}</span>}>
              <ul className="divide-y" data-testid="calls-day-list" data-date={d}>
                {list.map(row)}
              </ul>
            </Card>
          ))}
        </div>
      ) : live.length ? null : (
        <Card>
          <p className="text-sm text-ink-2" data-testid="calls-empty">
            No calls in the next {DAYS} days.
            {v.role === "coach" ? (
              <>
                {" "}
                Set them up in{" "}
                <Link href="/settings#calls" className="underline">
                  Settings → Calls
                </Link>
                .
              </>
            ) : null}
          </p>
        </Card>
      )}
      {v.role === "coach" ? (
        <p className="mt-4 text-xs text-ink-3">
          You see every call, with who it&apos;s for. Members see the calls their level is in.{" "}
          <Link href="/settings#calls" className="underline" data-testid="calls-settings-link">
            Edit the calls
          </Link>
        </p>
      ) : null}
    </>
  );
}
