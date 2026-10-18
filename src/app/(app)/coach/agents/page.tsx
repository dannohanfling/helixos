import Link from "next/link";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { CopyButton } from "@/components/copy-button";
import { FilePicker } from "@/components/file-picker";
import { AgentTokenButton } from "@/components/handoff-bits";
import {
  checkAgentConnectionAction,
  pingAgentAction,
  revokeAgentTokenAction,
  saveAgentCheckinsAction,
  sendReadingPackAction,
  tieConnectionAction,
} from "@/lib/actions/handoff";
import { AGENT_TOKEN_CLIENT, agentConnections, agentSettings } from "@/lib/handoff";
import { CHECK_LINE, connectionOf, envVarFor, failuresSince, pingLine } from "@/lib/engine/agent-connection";
import { seedCoachForum } from "@/lib/forum";
import { appUrl } from "@/lib/branded-email";
import { formatDateTime } from "@/lib/dates";
import {
  CHECKIN_EVERY,
  CHECKIN_TEXT,
  CHECKINS_PER_DAY,
  DAY_NAMES,
  NUDGE_LINE,
  starterPrompt,
} from "@/lib/engine/handoff";
import { todayInTz } from "@/lib/dates";

export const metadata = { title: "Agents" };

/**
 * Coach → Agents (rev 769 §1): each of your Forum agents gets its own connector access. A Code session (main, Body) uses a
 * token made here: shown once, sent as a header, revocable at once. Cowork connects through claude.ai's connector, which signs
 * in instead, so you tie that connection to the Cowork agent here. Either way, a message's sender is the agent, never a name in it.
 */
export default async function CoachAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ pack?: string; packFor?: string; error?: string; checked?: string; pinged?: string }>;
}) {
  const sp = await searchParams;
  const coach = await requireCoach();
  const o = { workspaceId: coach.workspace.id, userId: coach.user.id };
  await seedCoachForum(o);
  const [agents, tokens, apps] = await Promise.all([
    db.query.forumAgents.findMany({
      where: and(
        eq(schema.forumAgents.workspaceId, o.workspaceId),
        eq(schema.forumAgents.userId, o.userId),
        isNull(schema.forumAgents.builtIn),
      ),
    }),
    db.query.agentTokens.findMany({
      where: and(
        eq(schema.agentTokens.workspaceId, o.workspaceId),
        eq(schema.agentTokens.userId, o.userId),
        isNull(schema.agentTokens.revokedAt),
      ),
      orderBy: desc(schema.agentTokens.createdAt),
    }),
    db.query.connectedApps.findMany({
      where: and(
        eq(schema.connectedApps.workspaceId, o.workspaceId),
        eq(schema.connectedApps.userId, o.userId),
        isNull(schema.connectedApps.revokedAt),
        ne(schema.connectedApps.clientId, AGENT_TOKEN_CLIENT),
      ),
    }),
  ]);
  const checkins = new Map(
    await Promise.all(
      agents.map(async (a) => [a.id, await agentSettings(o, a.id)] as const),
    ),
  );
  const conns = await agentConnections(o, agents.map((a) => a.id));
  const now = new Date();
  const clock = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: coach.tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(
      new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`),
    );
  const at = (iso: string) =>
    formatDateTime(
      iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`,
      coach.tz,
      { zone: true },
    );
  const mcp = `${appUrl()}/api/mcp`;
  const claudeCode = `claude mcp add --transport http helixos ${mcp} --header "Authorization: Bearer \${HELIXOS_AGENT_TOKEN}"`;
  return (
    <>
      <PageHeader
        title="Agents"
        subtitle={
          <Link href="/coach/inbox" className="hover:underline">
            Your inbox →
          </Link>
        }
      />
      <Card title="Your agents" className="mb-4">
        <ul className="divide-y" data-testid="agents-list">
          {agents.map((a) => {
            const t = tokens.find((x) => x.agentId === a.id);
            return (
              <li
                key={a.id}
                id={`agent-${a.id}`}
                className="scroll-mt-20 space-y-2 py-3"
                data-testid="agent-row"
                data-agent={a.name}
              >
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium">{a.name}</span>
                  {a.role ? (
                    <span className="text-sm text-ink-2">{a.role}</span>
                  ) : null}
                  <span
                    className="text-xs text-ink-3"
                    data-testid="agent-token-state"
                  >
                    {t
                      ? `Token ending ${t.last4}, made ${at(t.createdAt)}${t.lastUsedAt ? `, last used ${at(t.lastUsedAt)}` : ", not used yet"}`
                      : "No token"}
                  </span>
                </div>
                {(() => {
                  // Check connection (H-559): what HelixOS saw of this agent's token, in plain words.
                  const k = conns.get(a.id)!;
                  const st = connectionOf({
                    agentName: a.name,
                    token: k.token,
                    lastTool: k.lastTool,
                    failures: failuresSince(k.failures, k.token?.lastUsedAt ?? null),
                    now,
                    clock,
                  });
                  const ping = pingLine(k.ping, clock);
                  const chip = st.chip === "done" ? "badge-good" : st.chip === "waiting" ? "badge-warn" : "";
                  const chipWord = { none: "No token", never: "Not connected", connected: "Connected", failing: "Failing", quiet: "Quiet" }[st.state];
                  return (
                    <div className="space-y-2 rounded-lg border p-2 text-sm" data-testid="agent-conn" data-state={st.state}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`badge ${chip}`} data-testid="agent-conn-chip">{chipWord}</span>
                        <span className="min-w-0" data-testid="agent-conn-line">{st.line}</span>
                      </div>
                      {sp.checked === a.id ? (
                        <p className="text-xs text-ink-3" data-testid="agent-conn-checked">Checked {clock(now.toISOString())}.</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <form action={checkAgentConnectionAction}>
                          <input type="hidden" name="agentId" value={a.id} />
                          <SubmitButton className="btn btn-soft min-h-11" pendingText="Checking…" data-testid="agent-check">
                            Check connection
                          </SubmitButton>
                        </form>
                        <form action={pingAgentAction}>
                          <input type="hidden" name="agentId" value={a.id} />
                          <SubmitButton className="btn btn-soft min-h-11" pendingText="Sending…" data-testid="agent-ping">
                            Ping {a.name}
                          </SubmitButton>
                        </form>
                      </div>
                      {ping ? <p data-testid="agent-ping-state">{ping}.</p> : null}
                      <p className="text-xs text-ink-3">The ping sends {a.name} an inbox message to ack. It works only while the agent&apos;s session is awake.</p>
                      <details className="text-sm" data-testid="agent-setup-help">
                        <summary className="flex min-h-11 cursor-pointer items-center font-medium">Setup help</summary>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2">
                          <li>
                            The token goes in the environment variable{" "}
                            <code className="break-all" data-testid="agent-env-var">{envVarFor(a.name)}</code>.
                          </li>
                          <li>
                            Add it in Claude Code → the environment the agent runs in (Default, unless you split them) → Environment variables, then start a <strong>new</strong> session. A running session doesn&apos;t see new variables.
                          </li>
                          <li>
                            If the environment holds other agents&apos; tokens too, also set <code>HELIXOS_AGENT_NAME={a.name}</code>, or its Forum light lands on another agent.
                          </li>
                          <li className="flex flex-wrap items-center gap-2">
                            <span>Then send it:</span>
                            <span className="italic" data-testid="agent-check-line">{CHECK_LINE}</span>
                            <CopyButton text={CHECK_LINE} label="Copy" className="btn btn-soft min-h-11" testId="agent-check-copy" />
                          </li>
                        </ul>
                      </details>
                    </div>
                  );
                })()}
                {(() => {
                  const c = checkins.get(a.id)!;
                  const today =
                    c.countDay === todayInTz(c.tz) ? c.countToday : 0;
                  return (
                    <>
                      <details
                        className="rounded-lg border p-2 text-sm"
                        data-testid="agent-start"
                      >
                        <summary className="cursor-pointer font-medium">
                          Start this agent
                        </summary>
                        <p className="mt-1 text-xs text-ink-3">
                          One prompt to paste into a new session. The rules it
                          needs are in the repository&apos;s CLAUDE.md; its
                          first job waits in the inbox.
                        </p>
                        <div className="mt-2 flex flex-wrap items-start gap-2">
                          <pre
                            className="min-w-0 flex-1 whitespace-pre-wrap rounded bg-surface-2 p-2 text-xs"
                            data-testid="agent-starter-prompt"
                          >
                            {starterPrompt(a, {
                              connector: claudeCode,
                              firstJob: null,
                            })}
                          </pre>
                          <CopyButton
                            text={starterPrompt(a, {
                              connector: claudeCode,
                              firstJob: null,
                            })}
                            label="Copy starter prompt"
                            className="btn btn-ghost btn-xs"
                          />
                        </div>
                        <form
                          action={sendReadingPackAction}
                          className="mt-3 space-y-2"
                          encType="multipart/form-data"
                          data-testid="agent-pack-form"
                        >
                          <input type="hidden" name="agentId" value={a.id} />
                          <p className="text-xs text-ink-3">
                            A reading pack: a brief from you to {a.name}, with
                            files (md, pdf, csv, json, zip or images; up to 20
                            MB each). It lands in its inbox as from Danno.
                          </p>
                          <input
                            className="field"
                            name="title"
                            placeholder="Reading pack: the Forum brief and the rules"
                            maxLength={140}
                            required
                            data-testid="agent-pack-title"
                          />
                          <textarea
                            className="field"
                            name="body"
                            rows={2}
                            placeholder="What to read first, and why"
                            maxLength={20000}
                            data-testid="agent-pack-body"
                          />
                          <FilePicker kind="file" name="files" multiple accept=".md,.pdf,.csv,.json,.zip,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov" testId="agent-pack-files" />
                          <SubmitButton
                            className="btn btn-soft btn-sm"
                            pendingText="Sending…"
                            data-testid="agent-pack-send"
                          >
                            Send the reading pack
                          </SubmitButton>
                          {sp.pack && sp.packFor === a.id ? (
                            <span
                              className="ml-2 text-sm text-good"
                              role="status"
                              data-testid="agent-pack-ok"
                            >
                              Sent as H-{sp.pack}.
                            </span>
                          ) : null}
                        </form>
                        <p className="mt-2 text-xs text-ink-3">
                          <Link href={`/forum#agent-${a.id}`}>
                            Its building on The Forum →
                          </Link>
                        </p>
                      </details>
                      <details
                        className="rounded-lg border p-2 text-sm"
                        data-testid="agent-checkins"
                      >
                        <summary className="cursor-pointer">
                          Check-ins:{" "}
                          <strong>
                            {c.checkins
                              ? `on, every ${c.everyMinutes < 60 ? `${c.everyMinutes} min` : `${c.everyMinutes / 60} h`}`
                              : "off"}
                          </strong>
                          <span
                            className="ml-2 text-xs text-ink-3"
                            data-testid="agent-checkin-state"
                          >
                            {c.lastCheckinAt
                              ? `last ${at(c.lastCheckinAt)}, ${c.lastAct}`
                              : "no check-in yet"}{" "}
                            · today {today} of {CHECKINS_PER_DAY}
                            {c.busyNote ? ` · busy: ${c.busyNote}` : ""}
                          </span>
                        </summary>
                        <form
                          action={saveAgentCheckinsAction}
                          className="mt-2 grid gap-2 sm:grid-cols-2"
                        >
                          <input type="hidden" name="agentId" value={a.id} />
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              name="checkins"
                              defaultChecked={c.checkins}
                              data-testid="agent-checkins-on"
                            />{" "}
                            Check-ins on
                          </label>
                          <label className="flex items-center gap-2">
                            Every
                            <select
                              name="every"
                              className="field w-auto"
                              defaultValue={String(c.everyMinutes)}
                            >
                              {CHECKIN_EVERY.map((m) => (
                                <option key={m} value={m}>
                                  {m < 60
                                    ? `${m} min`
                                    : m === 60
                                      ? "1 hour"
                                      : `${m / 60} hours`}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-2">
                            From{" "}
                            <input
                              name="from"
                              type="time"
                              className="field w-auto"
                              defaultValue={c.activeFrom}
                            />{" "}
                            to{" "}
                            <input
                              name="to"
                              type="time"
                              className="field w-auto"
                              defaultValue={c.activeTo}
                            />
                          </label>
                          <label className="flex items-center gap-2">
                            Time zone{" "}
                            <input
                              name="tz"
                              className="field"
                              defaultValue={c.tz}
                            />
                          </label>
                          <fieldset className="flex flex-wrap gap-2 sm:col-span-2">
                            <legend className="sr-only">Days</legend>
                            {DAY_NAMES.map((d, i) => (
                              <label
                                key={d}
                                className="flex items-center gap-1"
                              >
                                <input
                                  type="checkbox"
                                  name="days"
                                  value={i}
                                  defaultChecked={c.activeDays.includes(i)}
                                />{" "}
                                {d}
                              </label>
                            ))}
                          </fieldset>
                          <label className="sm:col-span-2">
                            <span className="label">
                              Session link (the Forum&apos;s Nudge opens it)
                            </span>
                            <input
                              name="sessionUrl"
                              type="url"
                              className="field"
                              defaultValue={c.sessionUrl ?? ""}
                              placeholder="https://claude.ai/code/…"
                              data-testid="agent-session-url"
                            />
                          </label>
                          <div className="sm:col-span-2">
                            <SubmitButton
                              className="btn btn-soft btn-sm"
                              pendingText="Saving…"
                              data-testid="agent-checkins-save"
                            >
                              Save
                            </SubmitButton>
                          </div>
                        </form>
                        <p className="mt-2 text-xs text-ink-2">
                          The standing check-in for {a.name}&apos;s scheduled
                          task (Scriba sets these up):
                        </p>
                        <div className="mt-1 flex flex-wrap items-start gap-2">
                          <pre
                            className="min-w-0 flex-1 whitespace-pre-wrap rounded bg-surface-2 p-2 text-xs"
                            data-testid="agent-checkin-text"
                          >
                            {CHECKIN_TEXT}
                          </pre>
                          <CopyButton
                            text={CHECKIN_TEXT}
                            label="Copy"
                            className="btn btn-ghost btn-xs"
                          />
                        </div>
                      </details>
                    </>
                  );
                })()}
                <div className="flex flex-wrap items-start gap-2">
                  <AgentTokenButton
                    agentId={a.id}
                    label={
                      t
                        ? "Make a new token (the old one stops)"
                        : "Make a token"
                    }
                  />
                  {t ? (
                    <form action={revokeAgentTokenAction}>
                      <input type="hidden" name="agentId" value={a.id} />
                      <SubmitButton
                        className="btn btn-ghost btn-sm"
                        pendingText="Revoking…"
                        data-testid="agent-token-revoke"
                      >
                        Revoke
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
          {!agents.length ? (
            <li className="py-2 text-sm text-ink-2">
              Add your agents on{" "}
              <Link href="/forum" className="underline">
                The Forum
              </Link>{" "}
              first.
            </li>
          ) : null}
        </ul>
      </Card>
      <Card title="Connecting a Code session" className="mb-4">
        {sp.error ? (
          <p
            className="mb-2 rounded-lg border border-warn bg-warn-soft p-2 text-sm"
            role="alert"
            data-testid="agent-pack-error"
          >
            {sp.error}
          </p>
        ) : null}
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Make the agent&apos;s token above and copy it.</li>
          <li>
            Add it as an environment variable called HELIXOS_AGENT_TOKEN in that
            session&apos;s own environment settings (or
            HELIXOS_TOKEN_&lt;NAME&gt;, which also names the agent). Never in
            the repo, a chat or a document. Also set HELIXOS_AGENT_NAME to the
            agent&apos;s name, so the Forum hook uses its token even when the
            environment holds other agents&apos; tokens too.
          </li>
          <li>Add HelixOS as a connector there:</li>
          <li>
            Paste the agent&apos;s starter prompt from its row above. The
            repository&apos;s hooks then light its building on The Forum on
            every wake and message, and any call it makes keeps it lit.
          </li>
        </ol>
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <pre
            className="min-w-0 flex-1 overflow-x-auto rounded bg-surface-2 p-2 text-xs"
            data-testid="agents-claude-code"
          >
            {claudeCode}
          </pre>
          <CopyButton
            text={claudeCode}
            label="Copy"
            className="btn btn-ghost btn-xs"
          />
        </div>
        <p className="mt-2 text-xs text-ink-3">
          It can use only The Forum and this inbox, as that one agent. Revoking
          stops it on its next call; its past messages stay.
        </p>
      </Card>
      <Card title="Connections that speak as an agent" className="mb-4">
        <p className="mb-2 text-sm text-ink-2">
          Cowork connects through claude.ai, which signs in rather than sending
          a token. Once you&apos;ve connected it (with The Forum and Handoff
          inbox ticked), tie the connection to its agent here.
        </p>
        <ul className="divide-y text-sm" data-testid="agents-connections">
          {apps.map((app) => (
            <li
              key={app.id}
              className="flex flex-wrap items-center gap-3 py-2"
              data-testid="agent-connection"
            >
              <span className="font-medium">{app.name}</span>
              <span className="text-xs text-ink-3">
                {app.scopes.includes("inbox")
                  ? "inbox ticked"
                  : "inbox not ticked: reconnect with Handoff inbox ticked"}
              </span>
              <form
                action={tieConnectionAction}
                className="ml-auto flex flex-wrap items-center gap-2"
              >
                <input type="hidden" name="appId" value={app.id} />
                <select
                  name="agentId"
                  className="field w-auto"
                  defaultValue={app.agentId ?? ""}
                  aria-label={`${app.name} speaks as`}
                  data-testid="agent-connection-select"
                >
                  <option value="">Not an agent</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      Speaks as {a.name}
                    </option>
                  ))}
                </select>
                <SubmitButton
                  className="btn btn-soft btn-sm"
                  pendingText="Saving…"
                  data-testid="agent-connection-save"
                >
                  Save
                </SubmitButton>
              </form>
            </li>
          ))}
          {!apps.length ? (
            <li className="py-2 text-ink-2">
              No connections yet.{" "}
              <Link href="/connect" className="underline">
                Connect HelixOS to Claude
              </Link>
              .
            </li>
          ) : null}
        </ul>
      </Card>
      <Card title="Nudge">
        <p className="text-sm text-ink-2">
          HelixOS can&apos;t wake a session. Paste this into an idle one:
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded bg-surface-2 px-2 py-1 text-xs">
            {NUDGE_LINE}
          </code>
          <CopyButton
            text={NUDGE_LINE}
            label="Copy"
            className="btn btn-ghost btn-xs"
          />
        </div>
      </Card>
    </>
  );
}
