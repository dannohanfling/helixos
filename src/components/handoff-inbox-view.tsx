import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ApprovalButtons, DecisionNote, HoldButtons } from "@/components/handoff-bits";
import { HandoffMarkdown } from "@/components/handoff-markdown";
import { answerHandoffAction, setApprovalEmailsAction, setCheckinsPausedAction, setStallEmailsAction, tickInboxNeedAction, writeToAgentAction } from "@/lib/actions/handoff";
import { InboxRefresh } from "@/components/inbox-refresh";
import { markOwnerRead, ownerInbox, supersededInbox, type InboxItem, type Owner } from "@/lib/handoff";
import { HOLD_LABEL, SUPERSEDED_LABEL, TITLE_PREFIXES } from "@/lib/engine/handoff";
import { forumSettingsFor } from "@/lib/forum";
import { formatDateTime } from "@/lib/dates";

const DECIDED: Record<string, string> = { approved: "Approved", changed: "Change asked", declined: "Declined" };
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** The member's empty Agent inbox (H-727): what it is for, and the two ways to connect an agent. */
export const AGENT_INBOX_EMPTY = "Your agent inbox. When an AI agent you've connected wants your OK on a plan, it lands here, and nothing happens until you tap Approve.";

export type InboxViewProps = {
  /** Whose inbox: always the signed-in member's own, or, read only, a member who shares their Forum with the coach. */
  o: Owner;
  ownerFirst: string;
  /** The viewer's zone, for every time on the page. */
  tz: string;
  tab?: string;
  q?: string;
  /** Where this inbox lives: "/coach/inbox", "/forum/inbox", or "/forum/inbox?member=…" for a shared one. */
  base: string;
  /** A shared inbox's member id, kept on the Superseded search. */
  member?: string;
  /** The Forum the pill goes back to. */
  forumHref: string;
  /** The coach's own inbox: the Agents link, check-ins and the email switches, which stay the coach's. */
  coach: boolean;
  /** A coach reading a member's shared inbox: no buttons, no forms, no file links, and nothing is marked read. */
  readOnly: boolean;
};

/**
 * The Handoff inbox (rev 769), one view for every owner (H-727): Coach → Inbox for the coach, the Agent inbox for a member,
 * and the same read only for a coach the member shares their Forum with. What waits for a decision first (Approve, Change,
 * Decline), then every message newest first, then the history of every post, file, ack, decision and token change. Agents'
 * words are shown as sanitised markdown; a claim of approval inside one is tagged "not an approval".
 */
export async function HandoffInboxView({ o, ownerFirst: first, tz, tab, q, base, member, forumHref, coach, readOnly }: InboxViewProps) {
  const link = (query: string) => `${base}${base.includes("?") ? "&" : "?"}${query}`;
  const history = tab === "history";
  const supersededTab = tab === "superseded";
  const superseded = supersededTab ? await supersededInbox(o, q ?? "") : [];
  const [{ items, waiting, fresh, needs, acks }, settings, log, agents] = await Promise.all([
    ownerInbox(o),
    coach ? forumSettingsFor(o) : Promise.resolve(null),
    history ? db.query.handoffAudit.findMany({ where: and(eq(schema.handoffAudit.workspaceId, o.workspaceId), eq(schema.handoffAudit.userId, o.userId)), orderBy: desc(schema.handoffAudit.at), limit: 200 }) : Promise.resolve([]),
    db.query.forumAgents.findMany({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId)), columns: { id: true, name: true, builtIn: true } }),
  ]);
  // Only the owner's own look marks things read; a coach reading a shared inbox leaves the member's count as it was.
  if (!readOnly) await markOwnerRead(o);
  const at = (iso: string) => formatDateTime(iso, tz, { zone: true });
  const agentName = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.name ?? "A removed agent") : readOnly ? first : "You");
  const ownAgents = agents.filter((a) => !a.builtIn);
  const empty = !coach && !readOnly && !items.length && !waiting.length;
  const nudgeFallback = coach ? "/coach/agents" : null;

  const Message = ({ m, decide }: { m: InboxItem; decide?: boolean }) => (
    <article id={m.ref} className="rounded-xl border p-3" data-testid="handoff-message" data-ref={m.ref}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-3">
        <span className="font-mono font-semibold text-ink">{m.ref}</span>
        <span>{m.kind}</span>
        <span className="[overflow-wrap:anywhere]">
          {m.from}
          {m.fromDanno && !readOnly ? " (from you)" : ""} → {m.to.join(", ") || "nobody"}
          {m.via ? <span className="ml-1 text-ink-3" data-testid="handoff-via"> · via {m.via}</span> : null}
        </span>
        {m.replyTo ? <span>re {m.replyTo}</span> : null}
        <span>{at(m.at)}</span>
        {m.decision ? (
          <span className="rounded-full bg-good-soft px-2 py-0.5 font-medium text-good" data-testid="handoff-decision">
            {DECIDED[m.decision]}
            {m.decisionFor ? ` ${m.decisionFor}` : ""}
          </span>
        ) : m.needsApproval ? (
          <span className="rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn" data-testid="handoff-needs">
            {readOnly ? `Needs ${first}'s approval` : "Needs your approval"}: {m.reasons.join(", ")}
          </span>
        ) : null}
        {m.claimsApproval ? (
          <span className="rounded-full border px-2 py-0.5" title={readOnly ? `Only ${first}'s own Approve counts.` : "Only your own Approve here counts."} data-testid="handoff-not-approval">
            says it&apos;s approved: not an approval
          </span>
        ) : null}
      </div>
      <p className="mt-1 font-medium [overflow-wrap:anywhere]">
        <MessageTitle m={m} historyHref={link("tab=history")} />
      </p>
      {m.body ? (
        <div className="mt-1">
          <HandoffMarkdown text={m.body} />
        </div>
      ) : null}
      {m.files.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {m.files.map((f) => (
            <li key={f.id}>
              {readOnly ? (
                <span data-testid="handoff-file-name">{f.name}</span>
              ) : (
                <a href={`/api/handoff/files/${f.id}`} className="underline" data-testid="handoff-file">
                  {f.name}
                </a>
              )}{" "}
              <span className="text-xs text-ink-3">{kb(f.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {(acks.get(m.id) ?? []).map((a, i) => (
        <p key={i} className="mt-1 text-xs text-ink-3" data-testid="handoff-ack">
          Seen by {a.recipient}, {at(a.at)}
          {a.note ? `: ${a.note}` : ""}
        </p>
      ))}
      {!readOnly && decide && !m.hold && !m.supersededBy ? <ApprovalButtons id={m.id} refLabel={m.ref} /> : null}
      {m.hold ? (
        <p className="mt-1 text-xs text-warn" data-testid="handoff-hold-reason-line">
          On hold: {m.hold.reason}
        </p>
      ) : null}
      {m.decision && !m.fromDanno ? <ReadLine m={m} at={at} nudge={readOnly ? null : (m.agentSessionUrl ?? nudgeFallback)} /> : null}
      {!readOnly && !m.fromDanno && !m.decision ? <HoldButtons refLabel={m.ref} held={Boolean(m.hold)} superseded={Boolean(m.supersededBy)} /> : null}
      {!readOnly && m.decision && !m.fromDanno ? <DecisionNote id={m.id} refLabel={m.ref} /> : null}
      {!readOnly && !decide && !m.fromDanno ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-ink-2">Answer {m.from}</summary>
          <form action={answerHandoffAction} className="mt-2 space-y-2">
            <input type="hidden" name="id" value={m.id} />
            <textarea name="body" className="field min-h-20" required maxLength={20000} data-testid="handoff-answer" />
            <SubmitButton className="btn btn-soft btn-sm" pendingText="Sending…" data-testid="handoff-answer-send">
              Send to {m.from}
            </SubmitButton>
          </form>
        </details>
      ) : null}
    </article>
  );

  return (
    <>
      {readOnly ? null : <InboxRefresh />}
      <PageHeader
        title={coach ? "Inbox" : readOnly ? `${first}'s agent inbox` : "Agent inbox"}
        subtitle={
          coach ? (
            <span>
              What your agents pass each other, and what waits for you.{" "}
              <Link href="/coach/agents" className="underline">
                Agents and their tokens →
              </Link>
            </span>
          ) : readOnly ? (
            <span data-testid="agent-inbox-readonly">Shared by {first}. Read only: only {first} can approve, change or decline anything.</span>
          ) : (
            <span>Your agents&apos; plans wait here for your OK. Only your own tap approves anything.</span>
          )
        }
        action={
          // H-719: one tap to The Forum and back.
          <Link href={forumHref} className="btn btn-soft inline-flex min-h-11 items-center gap-1.5 rounded-full px-4" data-testid="inbox-to-forum">
            <span aria-hidden>🏛️</span> The Forum
          </Link>
        }
      />
      <nav className="mb-4 flex flex-wrap gap-3 text-sm" aria-label="Inbox views">
        <Link href={base} aria-current={history || supersededTab ? undefined : "page"} className={history || supersededTab ? "underline" : "font-semibold"}>
          Inbox
        </Link>
        <Link href={link("tab=history")} aria-current={history ? "page" : undefined} className={history ? "font-semibold" : "underline"} data-testid="handoff-history-tab">
          History
        </Link>
        <Link href={link("tab=superseded")} aria-current={supersededTab ? "page" : undefined} className={supersededTab ? "font-semibold" : "underline"} data-testid="handoff-superseded-tab">
          Superseded
        </Link>
      </nav>
      {supersededTab ? (
        <Card title="Superseded">
          <form method="get" action={base.split("?")[0]} className="mb-3 flex flex-wrap items-end gap-2 text-sm" data-testid="handoff-superseded-search">
            <input type="hidden" name="tab" value="superseded" />
            {member ? <input type="hidden" name="member" value={member} /> : null}
            <label className="min-w-0 flex-1">
              <span className="label">Search</span>
              <input name="q" className="field" defaultValue={q ?? ""} placeholder="H-243, a word from the title" />
            </label>
            <button type="submit" className="btn btn-soft btn-sm">
              Search
            </button>
          </form>
          <div className="space-y-3" data-testid="handoff-superseded">
            {superseded.length ? superseded.map((m) => <Message key={m.id} m={m} />) : <p className="text-sm text-ink-2">Nothing has been replaced{q ? " that matches" : ""}. A replaced post comes here, never to the bin.</p>}
          </div>
        </Card>
      ) : null}
      {supersededTab ? null : history ? (
        <Card title="History">
          <ul className="divide-y text-sm" data-testid="handoff-history">
            {log.map((l) => (
              <li key={l.id} className="flex flex-wrap gap-x-3 py-1.5">
                <span className="text-xs text-ink-3">{at(l.at)}</span>
                <span className="font-medium">{agentName(l.agentId)}</span>
                <span>{l.action}</span>
                {l.ref ? <span className="font-mono text-xs">{l.ref}</span> : null}
                {l.note ? <span className="text-ink-2 [overflow-wrap:anywhere]">{l.note}</span> : null}
              </li>
            ))}
            {!log.length ? <li className="py-2 text-ink-2">Nothing yet.</li> : null}
          </ul>
        </Card>
      ) : (
        <div className="space-y-4">
          {empty ? (
            <Card>
              <div className="space-y-3 text-sm" data-testid="agent-inbox-empty">
                <p className="text-base">{AGENT_INBOX_EMPTY}</p>
                <div className="flex flex-wrap gap-2">
                  <Link href="/connect" className="btn btn-primary btn-sm" data-testid="agent-inbox-connect">
                    Connect to Claude
                  </Link>
                  <Link href="/forum#fo-h-add" className="btn btn-soft btn-sm" data-testid="agent-inbox-howto">
                    How to connect an agent
                  </Link>
                </div>
              </div>
            </Card>
          ) : (
            <>
              {/* H-1488 and H-1494: one list. The approvals waiting for a decision and the agents' open "needs you" items, the same
                  rows the Inbox number counts (with New for you below); an item leaves when its agent clears it, when the
                  approval it names is decided, when a "Merged PR #N" post names its PR, or on Done / Not needed here. */}
              <Card title={`${readOnly ? `Waiting on ${first}` : "Waiting on you"}${waiting.length + needs.length ? ` (${waiting.length + needs.length})` : ""}`}>
                <div className="space-y-3" data-testid="handoff-waiting">
                  {waiting.map((m) => (
                    <Message key={m.id} m={m} decide />
                  ))}
                  {needs.map((n) => (
                    <div key={n.id} className="rounded-xl border p-3" data-testid="handoff-need" data-stale={n.stale ? "true" : undefined}>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-3">
                        <span className="font-medium text-ink">{n.agent ?? "The Forum"}</span>
                        {n.when ? <span>{n.when}</span> : null}
                        <span>{at(n.at)}</span>
                        {n.stale ? <span className="rounded-full bg-surface-2 px-2 py-0.5">open more than three days</span> : null}
                      </div>
                      <p className="mt-1 text-sm [overflow-wrap:anywhere]">{n.what}</p>
                      {n.detail ? <p className="mt-1 text-xs text-ink-2 [overflow-wrap:anywhere]">{n.detail}</p> : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {n.ref ? (
                          <a href={`#${n.ref}`} className="text-xs underline" data-testid="handoff-need-thread">
                            Read {n.ref}
                          </a>
                        ) : null}
                        {!readOnly ? (
                          <form action={tickInboxNeedAction} className="flex gap-2">
                            <input type="hidden" name="id" value={n.id} />
                            <SubmitButton className="btn btn-soft btn-sm" pendingText="…" data-testid="handoff-need-done">
                              Done
                            </SubmitButton>
                            <SubmitButton className="btn btn-ghost btn-sm" pendingText="…" data-testid="handoff-need-skip">
                              Not needed
                            </SubmitButton>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {waiting.length + needs.length ? null : <p className="text-sm text-ink-2">{readOnly ? `Nothing waits for ${first}.` : "Nothing waits for you."}</p>}
                </div>
                <p className="mt-3 text-xs text-ink-3">{readOnly ? `Only ${first}'s own tap approves anything.` : "Only your tap here, or on The Forum, approves anything."} It reaches the agent once, in its next inbox check, and never carries over to later work.</p>
              </Card>
              {fresh.length ? (
                <Card title={`New for you (${fresh.length})`}>
                  <p className="mb-3 text-xs text-ink-3">Messages to you that you had not opened: the Inbox number counts them until this page has shown them.</p>
                  <div className="space-y-3" data-testid="handoff-fresh">
                    {fresh.map((m) => (
                      <Message key={m.id} m={m} />
                    ))}
                  </div>
                </Card>
              ) : null}
              <Card title="Messages">
                <div className="space-y-3" data-testid="handoff-messages">
                  {items.length ? items.map((m) => <Message key={m.id} m={m} />) : <p className="text-sm text-ink-2">{coach ? "No messages yet. Make an agent a token on Agents, and it can post here." : "No messages yet."}</p>}
                </div>
              </Card>
            </>
          )}
          {!readOnly && (coach || ownAgents.length) ? (
            <Card title="Write to an agent">
              <form action={writeToAgentAction} className="grid gap-2 text-sm sm:grid-cols-2" data-testid="handoff-write">
                <label>
                  <span className="label">To</span>
                  <select name="agentId" className="field" required data-testid="handoff-write-to">
                    {ownAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label">Kind</span>
                  <select name="kind" className="field" defaultValue="brief">
                    <option value="brief">Brief</option>
                    <option value="answer">Answer</option>
                  </select>
                </label>
                <label className="sm:col-span-2">
                  <span className="label">Title</span>
                  <input name="title" className="field" required maxLength={140} data-testid="handoff-write-title" />
                </label>
                <label className="sm:col-span-2">
                  <span className="label">Message</span>
                  <textarea name="body" className="field min-h-20" maxLength={20000} />
                </label>
                <label className="flex items-center gap-2 sm:col-span-2">
                  <input type="checkbox" name="urgent" data-testid="handoff-write-urgent" /> Urgent: it gets through even while the agent is busy
                </label>
                <div className="sm:col-span-2">
                  <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending…" data-testid="handoff-write-send">
                    Send
                  </SubmitButton>
                </div>
              </form>
            </Card>
          ) : null}
          {coach && settings ? (
            <>
              <Card title="Check-ins">
                <form action={setCheckinsPausedAction} className="flex flex-wrap items-center gap-3 text-sm" data-testid="handoff-pause">
                  <input type="hidden" name="on" value={settings.checkinsPaused ? "0" : "1"} />
                  <span>{settings.checkinsPaused ? "Paused: every agent's check-in answers quiet." : "Scheduled check-ins run as each agent's settings say."}</span>
                  <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="handoff-pause-toggle">
                    {settings.checkinsPaused ? "Resume check-ins" : "Pause all"}
                  </SubmitButton>
                  <Link href="/coach/agents" className="underline">
                    Each agent&apos;s check-ins
                  </Link>
                </form>
              </Card>
              <Card title="Emails">
                <form action={setApprovalEmailsAction} className="flex flex-wrap items-center gap-3 text-sm" data-testid="handoff-emails">
                  <input type="hidden" name="on" value={settings.approvalEmails ? "0" : "1"} />
                  <span>{settings.approvalEmails ? "You get an email when something needs your approval." : "No emails: check here and on The Forum."}</span>
                  <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="handoff-emails-toggle">
                    {settings.approvalEmails ? "Turn emails off" : "Turn emails on"}
                  </SubmitButton>
                </form>
                {/* H-495: when an agent stops checking in; the Forum and Today show it either way. */}
                <form action={setStallEmailsAction} className="mt-3 flex flex-wrap items-center gap-3 text-sm" data-testid="stall-emails">
                  <input type="hidden" name="on" value={settings.stallEmails ? "0" : "1"} />
                  <span>{settings.stallEmails ? "You get an email when an agent stops checking in." : "No email when an agent stops: the Forum and Today show it."}</span>
                  <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="stall-emails-toggle">
                    {settings.stallEmails ? "Stop these emails" : "Email me when an agent stops"}
                  </SubmitButton>
                </form>
              </Card>
            </>
          ) : null}
        </div>
      )}
    </>
  );
}

/** The title with its H-351 state at the front: bold amber HOLD, bold grey SUPERSEDED with a link to the newer post. Never red. */
function MessageTitle({ m, historyHref }: { m: InboxItem; historyHref: string }) {
  const bare = m.title.replace(TITLE_PREFIXES, "");
  if (m.supersededBy)
    return (
      <>
        <span className="font-bold text-ink-3" data-testid="handoff-superseded-label">
          {SUPERSEDED_LABEL(m.supersededBy).replace(m.supersededBy, "")}
          <Link href={`${historyHref}#${m.supersededBy}`} className="underline" data-testid="handoff-superseded-link">
            {m.supersededBy}
          </Link>{" "}
        </span>
        {bare}
      </>
    );
  if (m.hold)
    return (
      <>
        <span className="font-bold text-warn" data-testid="handoff-hold-label">
          {HOLD_LABEL}{" "}
        </span>
        {bare}
      </>
    );
  return <>{m.title}</>;
}

/**
 * H-356: whether the agent has read the owner's decision. "Read by" once its inbox read took it; until then "not read yet" with
 * its last inbox check, amber after three minutes with Nudge (the agent's session link, or Agents to set one). No Nudge when
 * there is nowhere to send it, or when the inbox is read only.
 */
function ReadLine({ m, at, nudge }: { m: InboxItem; at: (iso: string) => string; nudge: string | null }) {
  if (m.decisionReadAt)
    return (
      <p className="mt-1 text-xs text-good" data-testid="handoff-read-by">
        Read by {m.from} at {at(m.decisionReadAt)}
      </p>
    );
  const late = m.decisionLate;
  const external = Boolean(m.agentSessionUrl && nudge === m.agentSessionUrl);
  return (
    <p className={`mt-1 text-xs ${late ? "font-medium text-warn" : "text-ink-3"}`} data-testid={late ? "handoff-not-read-late" : "handoff-not-read"}>
      {late ? `${m.from} hasn't read it yet.` : `Not read yet.`} {m.agentSeenAt ? `Its last inbox read was ${at(m.agentSeenAt)}.` : ""}{" "}
      {late && nudge ? (
        <a href={nudge} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} className="underline" data-testid="handoff-nudge">
          Tap Nudge
        </a>
      ) : null}
    </p>
  );
}
