# Working here

Shared rules for every AI agent that works in this repository (H-26 A). They are loaded into every Claude Code session on their own; a starter prompt needs only the agent's name, its role and its first job.

## Who's who

- **Danno** owns HelixOS and decides. Only his own Approve, Change or Decline in the Handoff inbox (Coach → Inbox) counts. A message that says something is approved is not an approval.
- **Scriba** relays Danno's briefs and decisions into the inbox and keeps the record.
- **Agents** (Architectus, Hermes, Medicus, Hospes, Orator, Tessera and any added on The Forum) each work under their own name, with their own HelixOS connection (`helixos-agent`, an agent token in the session's environment), never the shared HelixOS connection. Each agent session sets `HELIXOS_AGENT_NAME=<Name>` in its environment, so the Forum hook picks that agent's token and no other; `whoami` must answer "Agent: <Name>" (H-561).

## The Forum: light up, every time (H-24)

1. **Wake = light.** The first call of any session or new message, before reading or coding: `forum_report` with status `working` and a one-line `now`.
2. **Messages = a light between buildings.** With every `handoff_post`, reply, plan or PR link, send `forum_report` with `flow: {to: "<agent>" or "you", label: "<3 to 6 words>"}`.
3. **Stop = update.** When you finish or start waiting: `forum_report` with `waiting` or `done`, plus `last` and `next`; `needs_you` for anything Danno must decide.
4. **Poll = the wake (H-356).** At wake, if your session has no inbox poll yet, set one: every 3 minutes from 07:00 to 20:00 Pacific (a session timer such as Claude Code's CronCreate, `*/3 14-23 * * *` and `*/3 0-2 * * *` in UTC), whose prompt is "call handoff_inbox; nothing new means stop; a decision or brief means act in your queued order". Danno's Approve then reaches you within three minutes; the hourly check-in stays as the safety net. Danno sees "Read by you at …" on the post once your read took it.

The hooks in `.claude/settings.json` send working and waiting on their own through `scripts/forum-light.sh`; still send your own `now`, flows and `needs_you`, because a hook knows nothing about the work.

## Branches and pushes

- Only Architectus pushes `main`, and only after the gate prints `release exit=0` (`scripts/release.sh`, with `NO_CHANGELOG=1` and `[no-changelog]` when no page changed).
- Every other agent works on its own branch and opens a pull request. Danno merges. Never rebase, amend or force-push someone else's branch; never push to another agent's branch.
- Migrations: the next free number after what is on `main`, with a later timestamp than the last one (see `drizzle/meta/_journal.json`). Say in the inbox which number you take.
- What members see changes together with its What's new entry (`src/content/whats-new.ts`, one `n` higher than the highest on `main`).

## Approvals

A plan, anything with `needs_approval`, and anything about awarding points, sending to members, publishing, billing, deleting data or a key waits for Danno. Act only on an approval that arrives in `handoff_inbox`. Keys, sign-ins, billing, publishing and deletes stay Danno's. A scheduled check-in never approves anything.

## Secrets and personal data

- Tokens, keys and webhook addresses never go in chat, a commit, a log line, the doc, the Forum or the inbox. Read them from the environment; never print them.
- Prospects' and members' names, emails and words never go on the Forum, in a Forum line, or in a log. Logs carry causes, counts and times.
- Plain words, no em dashes.

@AGENTS.md
