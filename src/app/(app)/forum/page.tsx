import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { canReadForum, forumSettingsFor, forumStateFor, seedCoachForum } from "@/lib/forum";
import { glossaryFor } from "@/lib/glossary";
import { markGlossary } from "@/lib/engine/glossary";
import { FORUM_BUILDINGS, FORUM_PLATFORMS, type ForumPlot, type ForumStateAgent } from "@/lib/engine/forum";
import { sceneLookFor } from "@/lib/engine/board-view";
import { formatDateTime } from "@/lib/dates";
import { confirmForumAgentAction, editForumAgentAction, removeForumAgentAction, setForumAgentMutedAction, setForumShareAction, setScheduleHiddenAction, tickForumNeedAction } from "@/lib/actions/forum";
import { scheduleBoard } from "@/lib/schedule";
import { STATE_WORDS } from "@/lib/engine/schedule";
import { watchForum } from "@/lib/forum-watch";
import { stallWords } from "@/lib/engine/forum-watch";
import { ForumMap } from "@/components/forum-map";
import { ForumAddAgent, ForumLive } from "@/components/forum-bits";
import { GlossaryText } from "@/components/glossary-text";
import { SubmitButton } from "@/components/submit-button";
import { CopyButton } from "@/components/copy-button";
import { AgentTokenButton, ApprovalButtons } from "@/components/handoff-bits";
import { revokeAgentTokenAction } from "@/lib/actions/handoff";
import { appUrl } from "@/lib/branded-email";
import { inboxCount, ownerInbox } from "@/lib/handoff";
import { NUDGE_LINE, inboxHref } from "@/lib/engine/handoff";
import "./forum.css";

export const metadata = { title: "The Forum" };

const CHIP: Record<ForumStateAgent["status"], string> = { working: "Working", waiting: "Waiting on you", idle: "Idle", done: "Done" };

/**
 * The Forum (rev 765): a live map of the member's AI agents, private to them; their coach sees it only while "Share with my
 * coach" is on. Top to bottom as in the mockup: the stamp, the headline, the map, what needs you, the road, each agent's
 * ledger and the latest news. Every time shows in the viewer's own zone with its short label (rev 779). Agent text is plain
 * text, with glossary words underlined (rev 768).
 */
export default async function ForumPage({ searchParams }: { searchParams: Promise<{ member?: string; road?: string; jobs?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  if (v.switchedInto) {
    return (
      <div className="fo-page">
        <div className="fo-wrap">
          <h1 className="fo-h1">The Forum</h1>
          <p className="fo-lede" data-testid="forum-private">
            {v.switchedInto.clientName}&apos;s Forum is private to them. If they turn on &quot;Share with my coach&quot;, you&apos;ll find it on your own Forum, under Shared with you.
          </p>
        </div>
      </div>
    );
  }
  const ownerId = sp.member && sp.member !== v.user.id ? sp.member : v.user.id;
  const own = ownerId === v.user.id;
  if (!own && !(await canReadForum(v, ownerId))) {
    return (
      <div className="fo-page">
        <div className="fo-wrap">
          <h1 className="fo-h1">The Forum</h1>
          <p className="fo-lede" data-testid="forum-private">
            This Forum is private. A member&apos;s Forum shows here only while they share it with you.
          </p>
        </div>
      </div>
    );
  }
  const m = { workspaceId: v.workspace.id, userId: ownerId };
  if (own && v.role === "coach") await seedCoachForum(m);
  // The stall watch (H-495) runs when the page opens too, so the Forum is never behind the five-minute cron.
  await watchForum(m);
  const [state, settings, glossary, owner, sharing] = await Promise.all([
    forumStateFor(m),
    forumSettingsFor(m),
    glossaryFor(v.workspace.id),
    own ? Promise.resolve(v.user) : db.query.users.findFirst({ where: eq(schema.users.id, ownerId) }),
    own && v.role === "coach"
      ? db
          .select({ userId: schema.forumSettings.userId, name: schema.users.name })
          .from(schema.forumSettings)
          .innerJoin(schema.users, eq(schema.users.id, schema.forumSettings.userId))
          .where(and(eq(schema.forumSettings.workspaceId, v.workspace.id), eq(schema.forumSettings.shareWithCoach, true)))
      : Promise.resolve([]),
  ]);
  const canEdit = own && !v.team;
  // The Handoff inbox (rev 769): the owner's waiting decisions sit in What needs you too, with the same three buttons; every
  // member's own since H-727.
  const inbox = own ? await ownerInbox(m, 1) : null;
  // The agent inbox button (H-719, H-727): on the owner's own Forum, to their own inbox (Coach → Inbox for the coach), with the menu's new count.
  const inboxLink = own && !v.switchedInto && !v.team ? await inboxCount(m) : null;
  const myInbox = inboxHref(v.role === "coach");
  // The Nudge and a stalled agent's item open its saved session link (13 Oct, H-495), when there is one.
  const sessions = own ? new Map((await db.query.handoffAgents.findMany({ where: and(eq(schema.handoffAgents.workspaceId, m.workspaceId), eq(schema.handoffAgents.userId, m.userId)), columns: { agentId: true, sessionUrl: true } })).map((r) => [r.agentId, r.sessionUrl])) : new Map<string, string | null>();
  const approvals = inbox?.waiting ?? [];
  // The Schedule board (H-1843): the jobs the agents report; a failed or missed one that's the owner's to fix is on What needs you.
  const showHidden = sp.jobs === "all";
  const jobs = await scheduleBoard(m, { hidden: showHidden });
  const jobNeeds = jobs.filter((j) => j.needsOwner);
  // Connect this agent (H-727 PR 2): a member's own agents' live tokens, last four only; the coach's are on Coach → Agents.
  const memberTokens = canEdit && v.role !== "coach" && !v.switchedInto
    ? new Map((await db.query.agentTokens.findMany({ where: and(eq(schema.agentTokens.workspaceId, m.workspaceId), eq(schema.agentTokens.userId, m.userId), isNull(schema.agentTokens.revokedAt)), columns: { agentId: true, last4: true, createdAt: true } })).map((t) => [t.agentId, t]))
    : null;
  const at = (iso: string) => formatDateTime(iso, v.tz, { zone: true });
  const firstName = (owner?.name ?? "This member").split(" ")[0];
  const rostra = state.waiting.length || jobNeeds.length ? "waiting" : state.agents.some((a) => a.status === "working") ? "working" : "idle";
  const roadAgent = sp.road && state.queue.some((q) => q.agentId === sp.road) ? sp.road : null;
  const road = roadAgent ? state.queue.filter((q) => q.agentId === roadAgent) : state.queue;
  const roadAgents = [...new Map(state.queue.map((q) => [q.agentId, q.agent])).entries()];
  const placeName = (p: ForumPlot | null) => (p ? FORUM_BUILDINGS[p].place : "Outer districts");
  const base = own ? "/forum" : `/forum?member=${encodeURIComponent(ownerId)}`;
  const join = (q: string) => `${base}${base.includes("?") ? "&" : "?"}${q}`;

  return (
    <div className="fo-page" data-testid="forum-page">
      <div className="fo-wrap">
        <header className="fo-header">
          <div>
            <div className="fo-eyebrow">{own ? (v.role === "coach" ? "HelixOS · the build team" : "HelixOS · your agents") : `Shared by ${firstName}`}</div>
            <h1 className="fo-h1">The Forum</h1>
            <p className="fo-lede">{own ? "Every AI agent working for you, where its work is, and what's travelling between them." : `${firstName}'s agents, shared with you. Read only.`}</p>
          </div>
          {inboxLink !== null ? (
            // H-719: the owner's own Forum links to their agent inbox, with the menu's new count; nobody else gets a link they can't open.
            <Link href={myInbox} className="fo-pill" data-testid="forum-to-inbox">
              <span aria-hidden>📥</span> Agent inbox
              {inboxLink > 0 ? (
                <span className="fo-pill-badge" aria-label={`${inboxLink} new`} data-testid="forum-inbox-badge">
                  {inboxLink}
                </span>
              ) : null}
            </Link>
          ) : null}
          <div className="fo-stamp" data-testid="forum-stamp">
            <b>{state.updatedAt ? `Updated ${at(state.updatedAt)}` : "Waiting for the first report"}</b>
            <ForumLive updatedAt={state.updatedAt} />
          </div>
        </header>

        {state.headline ? (
          <p className="fo-headline" data-testid="forum-headline">
            {state.headline}
          </p>
        ) : null}

        <ForumMap
          agents={state.agents.map((a) => ({ id: a.id, plot: a.plot, name: a.name, status: a.status, now: a.now }))}
          flows={state.flows.map((f) => ({ id: f.id, from: f.from, to: f.to, label: f.label, fromName: f.fromName, toName: f.toName, at: f.at, reply: f.reply }))}
          rostraStatus={rostra}
          initialLook={sceneLookFor(v.membership.sceneLook, v.hour)}
          canMove={canEdit}
          ownLook={!v.team}
        />

        <div className="fo-cols">
          <section aria-labelledby="fo-h-needs">
            <h2 id="fo-h-needs" className="fo-h2">
              What needs you
            </h2>
            <div className="fo-needs" data-testid="forum-needs">
              {approvals.map((w, i) => (
                <div key={w.id} className="fo-need" data-testid="forum-approval">
                  <div className="fo-n">{i + 1}</div>
                  <div>
                    <div className="fo-t">
                      {w.ref}: {w.title}
                    </div>
                    <div className="fo-meta">
                      <span className="fo-w">Needs your approval</span>
                      <span>
                        From {w.from}, {at(w.at)} · {w.reasons.join(", ")}
                      </span>
                      {w.claimsApproval ? <span>says it&apos;s approved: not an approval</span> : null}
                    </div>
                    <div className="fo-approve">
                      <ApprovalButtons id={w.id} refLabel={w.ref} />
                    </div>
                    <Link href={myInbox} className="fo-fine">
                      Read it in your inbox
                    </Link>
                  </div>
                </div>
              ))}
              {state.waiting.length ? (
                state.waiting.map((w, i) => (
                  <div key={w.id} className="fo-need" data-testid="forum-need">
                    <div className="fo-n">{approvals.length + i + 1}</div>
                    <div>
                      <div className="fo-t">{w.what}</div>
                      {w.detail ? <div className="fo-d">{w.detail}</div> : null}
                      {w.stall && w.agentId && sessions.get(w.agentId) ? (
                        <a href={sessions.get(w.agentId)!} target="_blank" rel="noopener noreferrer" className="fo-btn fo-small-btn fo-linkbtn" data-testid="forum-stall-session">
                          Open its session
                        </a>
                      ) : null}
                      <div className="fo-meta">
                        {w.when ? <span className={`fo-w${/^now/i.test(w.when) ? " fo-ok" : ""}`}>{w.when}</span> : null}
                        <span>
                          {w.agent ? `From ${w.agent}, ` : ""}
                          {at(w.at)}
                        </span>
                      </div>
                      {canEdit ? (
                        <form action={tickForumNeedAction}>
                          <input type="hidden" name="id" value={w.id} />
                          <SubmitButton className="fo-btn fo-small-btn" pendingText="Ticking…" data-testid="forum-need-tick">
                            Done
                          </SubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : approvals.length || jobNeeds.length ? null : (
                <div className="fo-empty">Nothing is waiting on you.</div>
              )}
              {jobNeeds.map((j, i) => (
                <div key={j.id} className="fo-need" data-testid="forum-job-need">
                  <div className="fo-n">{approvals.length + state.waiting.length + i + 1}</div>
                  <div>
                    <div className="fo-t">
                      {j.name}: {STATE_WORDS[j.state].toLowerCase()}
                    </div>
                    {j.reason ? <div className="fo-d">{j.reason}</div> : null}
                    <div className="fo-meta">
                      <span className="fo-w">On the Schedule board</span>
                      <span>From {j.agent}{j.lastAt ? `, ${at(j.lastAt)}` : ""}</span>
                    </div>
                  </div>
                </div>
              ))}
              {canEdit && state.waiting.length ? <p className="fo-fine">Ticking one done only clears it here. Nothing is sent back to the agent.</p> : null}
            </div>
          </section>
          <section aria-labelledby="fo-h-road">
            <h2 id="fo-h-road" className="fo-h2">
              {roadAgent ? `${roadAgents.find(([id]) => id === roadAgent)?.[1]}'s road` : "The road"}
            </h2>
            {roadAgents.length > 1 ? (
              <nav className="fo-roadpick" aria-label="Whose road">
                <Link href={base} aria-current={!roadAgent ? "page" : undefined}>
                  Everyone
                </Link>
                {roadAgents.map(([id, name]) => (
                  <Link key={id} href={join(`road=${encodeURIComponent(id)}`)} aria-current={roadAgent === id ? "page" : undefined}>
                    {name}
                  </Link>
                ))}
              </nav>
            ) : null}
            <div className="fo-roadmap" data-testid="forum-road">
              {road.length ? (
                road.map((q, i) => (
                  <div key={i} className={`fo-mile fo-${q.state}`}>
                    <div className="fo-k">{q.state === "now" ? "Building now" : q.state === "done" ? "Live" : "Queued"}</div>
                    <div className="fo-v">{q.name}</div>
                    <div className="fo-r">
                      {roadAgent ? "" : q.agent}
                      {q.rev ? `${roadAgent ? "" : " · "}${q.rev}` : ""}
                    </div>
                  </div>
                ))
              ) : (
                <div className="fo-empty">When an agent sends its queue, its milestones show here.</div>
              )}
            </div>
          </section>
        </div>

        <section aria-labelledby="fo-h-schedule" data-testid="forum-schedule">
          <h2 id="fo-h-schedule" className="fo-h2">
            The Schedule board
          </h2>
          <p className="fo-fine">Jobs your agents run on a schedule, as they report them. A job more than an hour late with no report shows as Missed.</p>
          {jobs.length ? (
            <div className="fo-jobs">
              {jobs.map((j) => (
                <div key={j.id} className="fo-job" data-testid="forum-job" data-state={j.state} data-hidden={j.hidden ? "1" : "0"}>
                  <div className="fo-job-main">
                    <div className="fo-t">{j.name}</div>
                    <div className="fo-meta">
                      <span>{j.agent}</span>
                      {j.when ? <span>{j.when}</span> : null}
                      {j.via ? <span>via {j.via}</span> : null}
                    </div>
                  </div>
                  <div className="fo-job-last">
                    <span className={`fo-w fo-job-${j.state}`} data-testid="forum-job-state">
                      {STATE_WORDS[j.state]}
                    </span>
                    <span className="fo-meta">
                      {j.lastAt ? `Last ${at(j.lastAt)}` : "No run yet"}
                      {j.reason ? ` · ${j.reason}` : ""}
                    </span>
                    <span className="fo-meta">{j.nextAt ? `Next ${at(j.nextAt)}` : "Next run not given"}</span>
                  </div>
                  {canEdit ? (
                    <form action={setScheduleHiddenAction}>
                      <input type="hidden" name="id" value={j.id} />
                      <input type="hidden" name="hidden" value={j.hidden ? "0" : "1"} />
                      <SubmitButton className="fo-btn fo-small-btn" pendingText="…" data-testid="forum-job-hide">
                        {j.hidden ? "Show" : "Hide"}
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="fo-empty" data-testid="forum-jobs-empty">No scheduled jobs yet. An agent adds one with schedule_report.</div>
          )}
          {canEdit ? (
            <Link href={join(showHidden ? "" : "jobs=all").replace(/[?&]$/, "")} className="fo-btn fo-linkbtn fo-jobs-toggle" data-testid="forum-jobs-toggle">
              {showHidden ? "Hide hidden rows" : "Show hidden"}
            </Link>
          ) : null}
        </section>

        <section aria-labelledby="fo-h-ledger">
          <h2 id="fo-h-ledger" className="fo-h2">
            Each agent&apos;s ledger
          </h2>
          <div className="fo-ledger" data-testid="forum-ledger">
            {state.agents.length ? (
              state.agents.map((a) => {
                const used = new Set<string>();
                return (
                  <article key={a.id} className="fo-card" data-forum-card={a.id} data-testid="forum-card">
                    <div className="fo-top">
                      <div>
                        <div className="fo-nm">
                          {a.name}
                          {a.isNew ? (
                            <span className="fo-new" data-testid="forum-new">
                              new
                            </span>
                          ) : null}
                        </div>
                        <div className="fo-pl">
                          {placeName(a.plot)}
                          {a.role ? ` · ${a.role}` : ""}
                        </div>
                      </div>
                      {a.paused ? (
                        <span className="fo-chip fo-paused" data-testid="forum-paused">
                          Paused
                        </span>
                      ) : (
                        <span className={`fo-chip fo-${a.status}`}>{CHIP[a.status]}</span>
                      )}
                    </div>
                    {a.paused ? (
                      <div className="fo-row fo-stall" data-testid="forum-stall-line">
                        {stallWords.card(at(a.paused))}
                      </div>
                    ) : null}
                    {(
                      [
                        ["Now", a.now],
                        ["Last", a.last],
                        ["Next", a.next],
                      ] as const
                    ).map(([k, t]) =>
                      t ? (
                        <div key={k} className="fo-row">
                          <b>{k}</b> <GlossaryText marks={markGlossary(t, glossary, used)} />
                        </div>
                      ) : null,
                    )}
                    <div className="fo-cardfoot">
                      {a.platform ? <span>{a.platform}</span> : null}
                      {a.reportedAt ? <span>{at(a.reportedAt)}</span> : null}
                      {a.link ? (
                        <a href={a.link} target="_blank" rel="noopener noreferrer nofollow">
                          {new URL(a.link).host}
                        </a>
                      ) : null}
                    </div>
                    {a.builtIn ? <p className="fo-fine">Reads what HelixOS already records.</p> : null}
                    {inbox && v.role === "coach" && !a.builtIn && a.status === "idle" ? (
                      <div className="fo-inline">
                        <span className="fo-fine">Idle. HelixOS can&apos;t wake a session:</span>
                        {sessions.get(a.id) ? (
                          <a href={sessions.get(a.id)!} target="_blank" rel="noopener noreferrer" className="fo-btn fo-small-btn fo-linkbtn" data-testid="forum-nudge-link">
                            Nudge: open its session
                          </a>
                        ) : (
                          <CopyButton text={NUDGE_LINE} label="Nudge: copy the line" className="fo-btn fo-small-btn" />
                        )}
                      </div>
                    ) : null}
                    {canEdit && a.isNew ? (
                      <form action={confirmForumAgentAction} className="fo-inline">
                        <input type="hidden" name="id" value={a.id} />
                        <span className="fo-fine">A report added this agent.</span>
                        <SubmitButton className="fo-btn fo-small-btn" pendingText="Saving…" data-testid="forum-confirm">
                          Yes, it&apos;s mine
                        </SubmitButton>
                      </form>
                    ) : null}
                    {memberTokens && !a.builtIn ? (
                      <details className="fo-edit" data-testid="forum-connect-agent">
                        <summary>Connect this agent</summary>
                        {(() => {
                          const t = memberTokens.get(a.id);
                          return (
                            <div className="fo-form">
                              <p className="fo-fine" data-testid="forum-token-state">
                                {t ? `Connected with a token ending ${t.last4}, made ${at(t.createdAt)}.` : "Not connected yet. Make its token, then put it in the agent's own settings."}
                              </p>
                              <p className="fo-fine">
                                The agent connects to <code className="break-all">{`${appUrl()}/api/mcp`}</code> with the token sent as Authorization: Bearer. It can report to your Forum and post to your agent inbox, and nothing else. Only your own tap in your inbox approves anything.
                              </p>
                              <div className="fo-inline">
                                <AgentTokenButton agentId={a.id} label={t ? "Make a new token (the old one stops)" : "Make its token"} />
                                {t ? (
                                  <form action={revokeAgentTokenAction}>
                                    <input type="hidden" name="agentId" value={a.id} />
                                    <SubmitButton className="fo-btn fo-small-btn" pendingText="Revoking…" data-testid="agent-token-revoke">
                                      Revoke
                                    </SubmitButton>
                                  </form>
                                ) : null}
                              </div>
                            </div>
                          );
                        })()}
                      </details>
                    ) : null}
                    {canEdit && !a.builtIn ? (
                      <details className="fo-edit">
                        <summary>Edit</summary>
                        {v.role === "coach" ? (
                          <p className="fo-fine">
                            <Link href={`/coach/agents#agent-${a.id}`}>Its connection and check-ins on the Agents page →</Link>
                          </p>
                        ) : null}
                        <form action={editForumAgentAction} className="fo-form">
                          <input type="hidden" name="id" value={a.id} />
                          <label>
                            <span>Name</span>
                            <input name="name" defaultValue={a.name} maxLength={40} required />
                          </label>
                          <label>
                            <span>Platform</span>
                            <input name="platform" defaultValue={a.platform ?? ""} maxLength={40} />
                          </label>
                          <label>
                            <span>Role</span>
                            <input name="role" defaultValue={a.role ?? ""} maxLength={80} />
                          </label>
                          <label>
                            <span>Link</span>
                            <input name="link" type="url" defaultValue={a.link ?? ""} maxLength={300} />
                          </label>
                          <label>
                            <span>Session link</span>
                            <input name="sessionUrl" type="url" defaultValue={sessions.get(a.id) ?? ""} maxLength={300} placeholder="https://claude.ai/code/…" data-testid="forum-session-url" />
                          </label>
                          <SubmitButton className="fo-btn" pendingText="Saving…">
                            Save
                          </SubmitButton>
                        </form>
                        <form action={setForumAgentMutedAction} className="fo-inline">
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="on" value={a.muted ? "0" : "1"} />
                          <span className="fo-fine">{a.muted ? "Not watched: it is never flagged as stopped." : "Flagged as Paused if it stops checking in."}</span>
                          <SubmitButton className="fo-btn fo-small-btn" pendingText="Saving…" data-testid="forum-mute">
                            {a.muted ? "Watch this agent" : "Don't watch this agent"}
                          </SubmitButton>
                        </form>
                        <form action={removeForumAgentAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <SubmitButton className="fo-btn fo-quiet" pendingText="Removing…" data-testid="forum-remove">
                            Remove {a.name} from the Forum
                          </SubmitButton>
                        </form>
                      </details>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <div className="fo-empty">Each agent&apos;s ledger appears here after its first report, or when you add one below.</div>
            )}
          </div>
        </section>

        <section aria-labelledby="fo-h-log">
          <h2 id="fo-h-log" className="fo-h2">
            Latest news
          </h2>
          <div className="fo-log" data-testid="forum-news">
            {state.log.length ? (
              state.log.map((e, i) => (
                <div key={i} className="fo-ev">
                  <div className="fo-at">{at(e.at)}</div>
                  <div className="fo-who">{e.who}</div>
                  <div>
                    <GlossaryText marks={markGlossary(e.text, glossary)} />
                  </div>
                </div>
              ))
            ) : (
              <div className="fo-empty">News appears here as your agents report.</div>
            )}
          </div>
        </section>

        {canEdit ? (
          <section aria-labelledby="fo-h-add" className="fo-panel">
            <h2 id="fo-h-add" className="fo-h2">
              Add an agent
            </h2>
            <ForumAddAgent platforms={FORUM_PLATFORMS} agentsHref={v.role === "coach" ? "/coach/agents" : undefined} />
            <h3 className="fo-h3">How your agents report</h3>
            <ul className="fo-how">
              {v.role === "coach" ? (
                <li>
                  <b>Each agent&apos;s connection and check-ins</b> are on the Agents page: its token, the Start this agent prompt, and when it&apos;s woken. <Link href="/coach/agents" data-testid="forum-agents-link">Manage them on the Agents page →</Link>
                </li>
              ) : null}
              <li>
                {v.role !== "coach" ? (
                  <>
                    <b>Its own token,</b> for an agent that runs on its own (a Claude Code session, a scheduled job): open the agent above and tap Connect this agent. The token carries your Forum and your agent inbox only.{" "}
                  </>
                ) : null}
                <b>The HelixOS connector.</b> In Claude (Code, Cowork or chat), Codex or any app that takes a connector, connect HelixOS and tick The Forum. The agent then has forum_report to say what it&apos;s doing, and forum_read to see the others. <Link href="/connect">How to connect</Link>
              </li>
              <li>
                <b>Your Forum webhook,</b> for Claude Code hooks, Codex, Zapier, Make, n8n, GoHighLevel and GitHub. <Link href="/settings?tab=programs#forum">Make one in Settings</Link>, with a ready example for each.
              </li>
              <li>
                <b>Built in.</b> Your booking bot, Ship, Recordings and My Board show up on their own when they have something to report.
              </li>
            </ul>
            <p className="fo-fine">
              An agent&apos;s words show as plain text. Anything that looks like a key or password is removed before it&apos;s saved. <Link href="/glossary">Words you&apos;ll see, in plain English</Link>
            </p>
            {v.role === "client" ? (
              <form action={setForumShareAction} className="fo-inline" data-testid="forum-share">
                <input type="hidden" name="on" value={settings.shareWithCoach ? "0" : "1"} />
                <span>{settings.shareWithCoach ? "Your coach can see your Forum." : "Your Forum is private to you."}</span>
                <SubmitButton className="fo-btn" pendingText="Saving…" data-testid="forum-share-go">
                  {settings.shareWithCoach ? "Stop sharing with my coach" : "Share with my coach"}
                </SubmitButton>
              </form>
            ) : null}
          </section>
        ) : null}

        {sharing.length ? (
          <section aria-labelledby="fo-h-shared" className="fo-panel" data-testid="forum-shared">
            <h2 id="fo-h-shared" className="fo-h2">
              Shared with you
            </h2>
            <ul className="fo-how">
              {sharing
                .filter((s) => s.userId !== v.user.id)
                .map((s) => (
                  <li key={s.userId}>
                    <Link href={`/forum?member=${encodeURIComponent(s.userId)}`}>{s.name}&apos;s Forum</Link>
                    {" · "}
                    <Link href={`/forum/inbox?member=${encodeURIComponent(s.userId)}`} data-testid="forum-shared-inbox">
                      Agent inbox
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
