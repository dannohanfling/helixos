import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ApprovalButtons, DecisionNote, HoldButtons } from "@/components/handoff-bits";
import { HandoffMarkdown } from "@/components/handoff-markdown";
import { answerHandoffAction, setApprovalEmailsAction, setCheckinsPausedAction, setStallEmailsAction, writeToAgentAction } from "@/lib/actions/handoff";
import { markOwnerRead, ownerInbox, supersededInbox, type InboxItem } from "@/lib/handoff";
import { HOLD_LABEL, SUPERSEDED_LABEL, TITLE_PREFIXES } from "@/lib/engine/handoff";
import { forumSettingsFor } from "@/lib/forum";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Inbox" };

const DECIDED: Record<string, string> = { approved: "Approved", changed: "Change asked", declined: "Declined" };
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/**
 * Coach → Inbox (rev 769): the Handoff inbox, the owner's own. What waits for a decision first (Approve, Change, Decline), then
 * every message newest first, then the history of every post, file, ack, decision and token change. Agents' words are shown as
 * sanitised markdown; a claim of approval inside one is tagged "not an approval".
 */
export default async function CoachInboxPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const coach = await requireCoach();
  const sp = await searchParams;
  const o = { workspaceId: coach.workspace.id, userId: coach.user.id };
  const history = sp.tab === "history";
  const supersededTab = sp.tab === "superseded";
  const superseded = supersededTab ? await supersededInbox(o, sp.q ?? "") : [];
  const [{ items, waiting, acks }, settings, log, agents] = await Promise.all([
    ownerInbox(o),
    forumSettingsFor(o),
    history ? db.query.handoffAudit.findMany({ where: and(eq(schema.handoffAudit.workspaceId, o.workspaceId), eq(schema.handoffAudit.userId, o.userId)), orderBy: desc(schema.handoffAudit.at), limit: 200 }) : Promise.resolve([]),
    db.query.forumAgents.findMany({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId)), columns: { id: true, name: true, builtIn: true } }),
  ]);
  await markOwnerRead(o);
  const at = (iso: string) => formatDateTime(iso, coach.tz, { zone: true });
  const agentName = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.name ?? "A removed agent") : "You");

  const Message = ({ m, decide }: { m: InboxItem; decide?: boolean }) => (
    <article className="rounded-xl border p-3" data-testid="handoff-message" data-ref={m.ref}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-3">
        <span className="font-mono font-semibold text-ink">{m.ref}</span>
        <span>{m.kind}</span>
        <span>
          {m.from}
          {m.fromDanno ? " (from you)" : ""} → {m.to.join(", ") || "nobody"}
        </span>
        {m.replyTo ? <span>re {m.replyTo}</span> : null}
        <span>{at(m.at)}</span>
        {m.decision ? (
          <span className="rounded-full bg-good-soft px-2 py-0.5 font-medium text-good" data-testid="handoff-decision">
            {DECIDED[m.decision]}
            {m.decisionFor ? ` ${m.decisionFor}` : ""}
          </span>
        ) : m.needsApproval ? (
          <span className="rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn" data-testid="handoff-needs">Needs your approval: {m.reasons.join(", ")}</span>
        ) : null}
        {m.claimsApproval ? (
          <span className="rounded-full border px-2 py-0.5" title="Only your own Approve here counts." data-testid="handoff-not-approval">
            says it&apos;s approved: not an approval
          </span>
        ) : null}
      </div>
      <p className="mt-1 font-medium [overflow-wrap:anywhere]"><MessageTitle m={m} /></p>
      {m.body ? <div className="mt-1"><HandoffMarkdown text={m.body} /></div> : null}
      {m.files.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {m.files.map((f) => (
            <li key={f.id}>
              <a href={`/api/handoff/files/${f.id}`} className="underline" data-testid="handoff-file">
                {f.name}
              </a>{" "}
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
      {decide && !m.hold && !m.supersededBy ? <ApprovalButtons id={m.id} refLabel={m.ref} /> : null}
      {m.hold ? <p className="mt-1 text-xs text-warn" data-testid="handoff-hold-reason-line">On hold: {m.hold.reason}</p> : null}
      {m.decision && !m.fromDanno ? <ReadLine m={m} at={at} /> : null}
      {!m.fromDanno && !m.decision ? <HoldButtons refLabel={m.ref} held={Boolean(m.hold)} superseded={Boolean(m.supersededBy)} /> : null}
      {m.decision && !m.fromDanno ? <DecisionNote id={m.id} refLabel={m.ref} /> : null}
      {!decide && !m.fromDanno ? (
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
      <PageHeader
        title="Inbox"
        subtitle={
          <span>
            What your agents pass each other, and what waits for you. <Link href="/coach/agents" className="underline">Agents and their tokens →</Link>
          </span>
        }
        action={
          // H-719: one tap to The Forum and back, for whoever can open both (this page is the coach's own already).
          <Link href="/forum" className="btn btn-soft inline-flex min-h-11 items-center gap-1.5 rounded-full px-4" data-testid="inbox-to-forum">
            <span aria-hidden>🏛️</span> The Forum
          </Link>
        }
      />
      <nav className="mb-4 flex gap-3 text-sm" aria-label="Inbox views">
        <Link href="/coach/inbox" aria-current={history ? undefined : "page"} className={history ? "underline" : "font-semibold"}>
          Inbox
        </Link>
        <Link href="/coach/inbox?tab=history" aria-current={history ? "page" : undefined} className={history ? "font-semibold" : "underline"} data-testid="handoff-history-tab">
          History
        </Link>
        <Link href="/coach/inbox?tab=superseded" aria-current={supersededTab ? "page" : undefined} className={supersededTab ? "font-semibold" : "underline"} data-testid="handoff-superseded-tab">
          Superseded
        </Link>
      </nav>
      {supersededTab ? (
        <Card title="Superseded">
          <form method="get" className="mb-3 flex flex-wrap items-end gap-2 text-sm" data-testid="handoff-superseded-search">
            <input type="hidden" name="tab" value="superseded" />
            <label className="min-w-0 flex-1">
              <span className="label">Search</span>
              <input name="q" className="field" defaultValue={sp.q ?? ""} placeholder="H-243, a word from the title" />
            </label>
            <button type="submit" className="btn btn-soft btn-sm">
              Search
            </button>
          </form>
          <div className="space-y-3" data-testid="handoff-superseded">
            {superseded.length ? superseded.map((m) => <Message key={m.id} m={m} />) : <p className="text-sm text-ink-2">Nothing has been replaced{sp.q ? " that matches" : ""}. A replaced post comes here, never to the bin.</p>}
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
          <Card title={`Waiting for your decision${waiting.length ? ` (${waiting.length})` : ""}`}>
            <div className="space-y-3" data-testid="handoff-waiting">
              {waiting.length ? waiting.map((m) => <Message key={m.id} m={m} decide />) : <p className="text-sm text-ink-2">Nothing waits for you.</p>}
            </div>
            <p className="mt-3 text-xs text-ink-3">Only your tap here, or on The Forum, approves anything. It reaches the agent once, in its next inbox check, and never carries over to later work.</p>
          </Card>
          <Card title="Messages">
            <div className="space-y-3" data-testid="handoff-messages">
              {items.length ? items.map((m) => <Message key={m.id} m={m} />) : <p className="text-sm text-ink-2">No messages yet. Make an agent a token on Agents, and it can post here.</p>}
            </div>
          </Card>
          <Card title="Write to an agent">
            <form action={writeToAgentAction} className="grid gap-2 text-sm sm:grid-cols-2" data-testid="handoff-write">
              <label>
                <span className="label">To</span>
                <select name="agentId" className="field" required data-testid="handoff-write-to">
                  {agents.filter((a) => !a.builtIn).map((a) => (
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
        </div>
      )}
    </>
  );
}

/** The title with its H-351 state at the front: bold amber HOLD, bold grey SUPERSEDED with a link to the newer post. Never red. */
function MessageTitle({ m }: { m: InboxItem }) {
  const bare = m.title.replace(TITLE_PREFIXES, "");
  if (m.supersededBy)
    return (
      <>
        <span className="font-bold text-ink-3" data-testid="handoff-superseded-label">
          {SUPERSEDED_LABEL(m.supersededBy).replace(m.supersededBy, "")}
          <Link href={`/coach/inbox?tab=history#${m.supersededBy}`} className="underline" data-testid="handoff-superseded-link">
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
 * H-356: whether the agent has read Danno's decision. "Read by" once its inbox read took it; until then "not read yet" with its
 * last inbox check, amber after three minutes with Nudge (the agent's session link, or Agents to set one).
 */
function ReadLine({ m, at }: { m: InboxItem; at: (iso: string) => string }) {
  if (m.decisionReadAt) return <p className="mt-1 text-xs text-good" data-testid="handoff-read-by">Read by {m.from} at {at(m.decisionReadAt)}</p>;
  const late = m.decisionLate;
  return (
    <p className={`mt-1 text-xs ${late ? "font-medium text-warn" : "text-ink-3"}`} data-testid={late ? "handoff-not-read-late" : "handoff-not-read"}>
      {late ? `${m.from} hasn't read it yet.` : `Not read yet.`} {m.agentSeenAt ? `Its last inbox read was ${at(m.agentSeenAt)}.` : ""}{" "}
      {late ? (
        <a href={m.agentSessionUrl ?? "/coach/agents"} target={m.agentSessionUrl ? "_blank" : undefined} rel={m.agentSessionUrl ? "noopener noreferrer" : undefined} className="underline" data-testid="handoff-nudge">
          Tap Nudge
        </a>
      ) : null}
    </p>
  );
}
