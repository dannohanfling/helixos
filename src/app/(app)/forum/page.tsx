import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { canReadForum, forumSettingsFor, forumStateFor, seedCoachForum } from "@/lib/forum";
import { glossaryFor } from "@/lib/glossary";
import { markGlossary } from "@/lib/engine/glossary";
import { FORUM_BUILDINGS, FORUM_PLATFORMS, type ForumPlot, type ForumStateAgent } from "@/lib/engine/forum";
import { sceneLookFor } from "@/lib/engine/board-view";
import { formatDateTime } from "@/lib/dates";
import { confirmForumAgentAction, editForumAgentAction, removeForumAgentAction, setForumShareAction, tickForumNeedAction } from "@/lib/actions/forum";
import { ForumMap } from "@/components/forum-map";
import { ForumAddAgent, ForumLive } from "@/components/forum-bits";
import { GlossaryText } from "@/components/glossary-text";
import { SubmitButton } from "@/components/submit-button";
import { CopyButton } from "@/components/copy-button";
import { ApprovalButtons } from "@/components/handoff-bits";
import { ownerInbox } from "@/lib/handoff";
import { NUDGE_LINE } from "@/lib/engine/handoff";
import "./forum.css";

export const metadata = { title: "The Forum" };

const CHIP: Record<ForumStateAgent["status"], string> = { working: "Working", waiting: "Waiting on you", idle: "Idle", done: "Done" };

/**
 * The Forum (rev 765): a live map of the member's AI agents, private to them; their coach sees it only while "Share with my
 * coach" is on. Top to bottom as in the mockup: the stamp, the headline, the map, what needs you, the road, each agent's
 * ledger and the latest news. Every time shows in the viewer's own zone with its short label (rev 779). Agent text is plain
 * text, with glossary words underlined (rev 768).
 */
export default async function ForumPage({ searchParams }: { searchParams: Promise<{ member?: string; road?: string }> }) {
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
  // The Handoff inbox (rev 769): the coach's waiting decisions sit in What needs you too, with the same three buttons.
  const inbox = own && v.role === "coach" ? await ownerInbox(m, 1) : null;
  // The Nudge opens an agent's saved session link (13 Oct), when there is one.
  const sessions = inbox ? new Map((await db.query.handoffAgents.findMany({ where: and(eq(schema.handoffAgents.workspaceId, m.workspaceId), eq(schema.handoffAgents.userId, m.userId)), columns: { agentId: true, sessionUrl: true } })).map((r) => [r.agentId, r.sessionUrl])) : new Map<string, string | null>();
  const approvals = inbox?.waiting ?? [];
  const at = (iso: string) => formatDateTime(iso, v.tz, { zone: true });
  const firstName = (owner?.name ?? "This member").split(" ")[0];
  const rostra = state.waiting.length ? "waiting" : state.agents.some((a) => a.status === "working") ? "working" : "idle";
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
          flows={state.flows.map((f) => ({ from: f.from, to: f.to, label: f.label }))}
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
                    <Link href="/coach/inbox" className="fo-fine">
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
              ) : approvals.length ? null : (
                <div className="fo-empty">Nothing is waiting on you.</div>
              )}
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
                      <span className={`fo-chip fo-${a.status}`}>{CHIP[a.status]}</span>
                    </div>
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
                    {inbox && !a.builtIn && a.status === "idle" ? (
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
                          <SubmitButton className="fo-btn" pendingText="Saving…">
                            Save
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
                <b>The HelixOS connector.</b> In Claude (Code, Cowork or chat), Codex or any app that takes a connector, connect HelixOS and tick The Forum. The agent then has forum_report to say what it&apos;s doing, and forum_read to see the others. <Link href="/connect">How to connect</Link>
              </li>
              <li>
                <b>Your Forum webhook,</b> for Claude Code hooks, Codex, Zapier, Make, n8n, GoHighLevel and GitHub. <Link href="/settings#forum">Make one in Settings</Link>, with a ready example for each.
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
                  </li>
                ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
