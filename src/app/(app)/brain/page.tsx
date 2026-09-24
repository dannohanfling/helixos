import Link from "next/link";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { ConfirmDelete } from "@/components/confirm-delete";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { acceptFaqAction, acceptSafeFaqAction, deleteFaqAction, importFaqAction, sendFaqAction, updateFaqAction } from "@/lib/actions/faq";
import { briefAccessFor, changedSinceLastPush, faqFieldFor, isApprovedOrigin, lastPushedLine, payloadFor, stage1Preview } from "@/lib/community-loyalty";
import { YourBotPanel } from "@/components/your-bot";
import { NOTHING_CURRENT_LABEL, PRODUCT_FIELD, PRODUCT_FIELD_OLD, TEMPLATE_BOT_FIELDS, priceAnswerFor } from "@/lib/engine/bot-fields";
import { FAQ_EMPTY_SENT, FAQ_FIELD_BUDGET, agentReadsFields, isFaqEmptyValue, composeField, diffSinceSync, needsEyes, notReadWarning, rankEntries } from "@/lib/engine/faq";
import { ACCEPT_LABEL, UNREVIEWED_LABEL, isUnreviewed } from "@/lib/engine/provenance";
import { essenceFor } from "@/lib/queries/essence";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import type { FaqEntry } from "@/db/schema";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Your bot" };

const s = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map(String).join(", ") : "");

/**
 * The Bot Brief: one page, plain language, the only way anything reaches a client's Community Loyalty bot. The coach brings
 * their business knowledge in by upload or paste (the Knowledge Base Builder format, parsed deterministically), reads what the
 * bot would know, approves each answer (anything naming a price, a guarantee, a result or a number is pinned under "Needs your
 * eyes" and never bulk-accepted), and sends. Before a send the target agent is read and only the fields it reads are shown;
 * after it, the value and the token are read back. Every approval and every send is logged with who and when.
 */
export default async function BrainPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const m = v.membership;
  const field = faqFieldFor(m);
  // The two reads of the bot, the Your bot panel's and the FAQ's, go side by side: one after the other doubled the wait (24 Sep).
  const [entries, syncs, log, essence, { payload: stage1, input }, preview, changedSince, pushedLine, access] = await Promise.all([
    db.query.faqEntries.findMany({ where: and(eq(schema.faqEntries.workspaceId, v.workspace.id), eq(schema.faqEntries.userId, v.user.id)), orderBy: [desc(schema.faqEntries.createdAt)] }),
    db.query.faqSyncs.findMany({ where: and(eq(schema.faqSyncs.workspaceId, v.workspace.id), eq(schema.faqSyncs.userId, v.user.id)), orderBy: [desc(schema.faqSyncs.createdAt), desc(sql`rowid`)], limit: 10 }),
    db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.workspaceId, v.workspace.id), eq(schema.syncEvents.userId, v.user.id), like(schema.syncEvents.event, "faq.%")), orderBy: [desc(schema.syncEvents.createdAt)], limit: 50 }),
    essenceFor(v.workspace.id, v.user.id),
    payloadFor(m),
    stage1Preview(m),
    changedSinceLastPush(m),
    lastPushedLine(m, v.user.id, v.workspace.timezone),
    briefAccessFor(m),
  ]);
  const coachLines = input.coach ?? {};
  const oneOnOne = input.offers.some((o) => o.botRole === "one_on_one") && coachLines.oneOnOneRange?.trim();
  const priceLine = `How it handles price: asked early, it answers with no numbers, “${priceAnswerFor(coachLines.priceAnswer)}”, then asks a question. Numbers come only once it knows enough to recommend something${oneOnOne ? ", and never the one-on-one range and a start price in one breath" : ""}.`;
  const { hasToken: token, agent, blocked, warning, fieldVarType, nsByName, heldValue } = access;
  // Push only what the agent reads: of the template's fields and the FAQ's own, the ones whose token is in the agent's prompt.
  const candidates = [...new Set([...TEMPLATE_BOT_FIELDS, PRODUCT_FIELD_OLD, field])];
  const reads = agent ? agentReadsFields(agent, candidates, nsByName) : null;
  const fieldRead = Boolean(reads?.reads.includes(field));

  const approved = entries.filter((e) => isApprovedOrigin(e.origin));
  const unreviewed = entries.filter((e) => isUnreviewed(e.origin));
  const eyes = unreviewed.filter((e) => needsEyes(e));
  const safe = unreviewed.filter((e) => !needsEyes(e));
  const composed = composeField(rankEntries(approved));
  const lastSent = syncs.find((x) => x.status === "sent") ?? null;
  const changes = diffSinceSync(composed.included.map((e) => ({ id: e.id, question: e.question, answer: e.answer })), lastSent?.snapshot ?? null);
  const byCategory = new Map<string, FaqEntry[]>();
  for (const e of approved) byCategory.set(e.category || "Uncategorised", [...(byCategory.get(e.category || "Uncategorised") ?? []), e]);
  const identity = (essence.identity ?? {}) as Record<string, unknown>;
  const who = s(identity.bot_persona) || [s(identity.name), s(identity.role)].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader title="Your bot" subtitle="Everything your bot is sent, in plain language, and the one place it is sent from. Nothing reaches Community Loyalty without your approval here." />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" data-testid="brain-error" role="alert">{sp.error}</p>
      ) : null}
      {sp.imported ? (
        <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" data-testid="brain-imported" role="status">{sp.imported} {sp.imported === "1" ? "entry" : "entries"} imported. Each one is a draft until you accept it.</p>
      ) : null}
      {sp.sent ? (
        <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" data-testid="brain-sent" role="status">{lastSent && lastSent.entryCount === 0 ? FAQ_EMPTY_SENT : <>Sent to your bot and read back: {(lastSent?.note ?? "done").replace(/\.+$/, "")}.</>}</p>
      ) : null}

      {eyes.length ? (
        <Card title={`Needs your eyes · ${eyes.length}`} className="mb-4 border-warn">
          <p className="mb-2 text-sm text-ink-2">Each of these names a price, a guarantee, a result or a number. Read it and accept it yourself; these are never accepted in bulk.</p>
          <ul className="space-y-3" data-testid="needs-eyes">
            {eyes.map((e) => (
              <EntryRow key={e.id} e={e} pinned />
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mb-6">
        <YourBotPanel m={m} preview={preview} own whose="your bot" sp={sp} lastPushedLine={`${pushedLine}${changedSince ? " · changed since the last push" : ""}`} />
      </div>
      <h2 className="mb-3 text-lg font-semibold" id="faq">Your FAQ answers</h2>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-4">
          <Card title="Bring your knowledge in">
            <form action={importFaqAction} className="space-y-2" encType="multipart/form-data" data-testid="faq-import">
              <label className="block text-sm">
                <span className="label">A file (.md, .txt or .docx)</span>
                <input className="field" type="file" name="file" accept=".md,.txt,.markdown,.docx,.pdf" data-testid="faq-file" />
              </label>
              <label className="block text-sm">
                <span className="label">Or paste the Knowledge Base Builder output</span>
                <textarea className="field min-h-32" name="text" placeholder={"### Q: How much does it cost?\n**Also asked:** …\n**Keywords:** …\n**Answer:** …\n**Category:** Pricing"} data-testid="faq-text" />
              </label>
              <SubmitButton className="btn btn-primary btn-sm" data-testid="faq-import-send" pendingText="Importing…">Import</SubmitButton>
            </form>
            <p className="mt-2 text-xs text-ink-3">Read exactly as written, no AI: each entry starts with <code>### Q:</code>. Every entry lands as a draft.</p>
          </Card>

          <Card title={`Drafts to accept · ${safe.length}`}>
            {safe.length ? (
              <>
                <form action={acceptSafeFaqAction} className="mb-3">
                  <SubmitButton className="btn btn-soft btn-sm" data-testid="accept-safe" pendingText="Accepting…">Accept the {safe.length} that need no eyes</SubmitButton>
                </form>
                <ul className="space-y-3" data-testid="drafts">
                  {safe.map((e) => (
                    <EntryRow key={e.id} e={e} />
                  ))}
                </ul>
              </>
            ) : (
              <Empty title="No drafts waiting" hint="Import a file or paste the template's output above." />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="What your bot would know" action={
            token && (approved.length || (lastSent && lastSent.entryCount > 0)) && fieldRead && !blocked ? (
              <form action={sendFaqAction}>
                <SubmitButton className="btn btn-primary btn-sm" data-testid="send-bot" pendingText={approved.length ? "Sending to your bot…" : "Clearing your bot's answers…"}>{approved.length ? "Approve and send to my bot" : "Clear my bot's FAQ answers"}</SubmitButton>
              </form>
            ) : null
          }>
            {sp.failed ? (
              <p className="mb-3 rounded-lg border border-danger bg-danger-soft p-2 text-sm font-medium" data-testid="brain-send-failed" role="alert">{sp.failed}</p>
            ) : null}
            {!token ? (
              <p className="mb-3 rounded-lg bg-warn-soft p-2 text-sm" data-testid="no-token">No Community Loyalty token on your account yet. {v.role === "coach" ? <>Add it yourself under <Link href="/coach" className="underline">My bot</Link> on the Coach page</> : "Ask your coach to add it on the Coach page"}; until then nothing can be sent.</p>
            ) : null}
            {blocked ? (
              <p className="mb-3 rounded-lg border border-warn bg-warn-soft p-2 text-sm" data-testid="brief-blocked" role="alert">{blocked}</p>
            ) : null}
            {warning ? (
              <p className="mb-3 rounded-lg bg-warn-soft p-2 text-xs" data-testid="brief-warning">{warning}</p>
            ) : null}
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-semibold">Who it speaks as</dt>
                <dd className="text-ink-2" data-testid="brief-who">{who || "Your Essence's Identity section is empty; fill name and role there."} <span className="text-ink-3">(A sample reply in your voice comes with Essence drafting, a later phase.)</span></dd>
              </div>
              <div>
                <dt className="font-semibold">What it offers</dt>
                <dd className="whitespace-pre-line text-ink-2" data-testid="brief-offers">{stage1[PRODUCT_FIELD] || `${NOTHING_CURRENT_LABEL[PRODUCT_FIELD]}.`}</dd>
                <dd className="text-xs text-ink-3" data-testid="brief-price">{priceLine}</dd>
              </div>
              <div>
                <dt className="font-semibold">What it knows · {approved.length} approved {approved.length === 1 ? "answer" : "answers"}</dt>
                <dd data-testid="brief-knows">
                  {approved.length ? (
                    <ul className="mt-1 space-y-1">
                      {[...byCategory.entries()].map(([cat, list]) => (
                        <li key={cat}>
                          <details>
                            <summary className="cursor-pointer text-ink-2"><Badge>{cat}</Badge> {list.length}</summary>
                            <ul className="mt-1 space-y-2 pl-2 text-xs">
                              {list.map((e) => (
                                <li key={e.id}><span className="font-medium">{e.question}</span><br />{e.answer}</li>
                              ))}
                            </ul>
                          </details>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-ink-3">Nothing approved yet.</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">What it won&apos;t do</dt>
                <dd className="whitespace-pre-line text-xs text-ink-2" data-testid="brief-constraints">{stage1.ai_constraints_cbf}</dd>
              </div>
              <div>
                <dt className="font-semibold">When it steps aside</dt>
                <dd className="text-ink-2" data-testid="brief-aside">It asks three questions ({[stage1.qualifying_question_1, stage1.qualifying_question_2, stage1.qualifying_question_3].filter(Boolean).length} set), then books a call. Anything it cannot answer, it hands to {v.user.name} personally.</dd>
              </div>
              <div>
                <dt className="font-semibold">What changed since the last sync</dt>
                <dd data-testid="brief-changes">
                  {/* What the bot holds now, read live, never what the last sync record says (23 Sep: the record said the sentence; the bot was empty). */}
                  {heldValue !== null && isFaqEmptyValue(heldValue) ? (
                    <p className="text-ink-2" data-testid="brief-holds-none">Your bot holds no approved answers{lastSent ? ` (sent ${formatDateTime(lastSent.createdAt, v.workspace.timezone)})` : ""}.</p>
                  ) : null}
                  {heldValue !== null && !heldValue.trim() ? (
                    <p className="text-warn" data-testid="brief-holds-empty">Your bot&apos;s FAQ field is empty{lastSent ? " (changed outside HelixOS)" : ""}.</p>
                  ) : null}
                  {lastSent ? (
                    <span className="text-ink-2">{changes.added.length} added, {changes.edited.length} edited, {changes.removed.length} removed since {formatDateTime(lastSent.createdAt, v.workspace.timezone)}.</span>
                  ) : (
                    <span className="text-ink-2">Never sent yet: all {composed.included.length} approved answers would go.</span>
                  )}
                  {changes.edited.length ? <ul className="mt-1 list-disc pl-5 text-xs text-ink-3">{changes.edited.map((e) => <li key={e.id} data-testid="changed-edited">{e.question}</li>)}</ul> : null}
                  {changes.added.length && lastSent ? <ul className="mt-1 list-disc pl-5 text-xs text-ink-3">{changes.added.map((e) => <li key={e.id} data-testid="changed-added">{e.question}</li>)}</ul> : null}
                  {changes.removed.length ? <ul className="mt-1 list-disc pl-5 text-xs text-ink-3">{changes.removed.map((e) => <li key={e.id} data-testid="changed-removed">{e.question} (removed)</li>)}</ul> : null}
                  {!approved.length && lastSent && lastSent.entryCount > 0 ? <p className="mt-1 text-xs text-warn" data-testid="brief-will-empty">You have removed every answer. Sending now tells your bot there are no approved answers yet, so it stops answering from them. (Community Loyalty doesn&apos;t allow an empty field, so that sentence is what it holds.)</p> : null}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Where it goes, and the budget</dt>
                <dd className="text-ink-2" data-testid="brief-budget">
                  Field <code>{field}</code>{fieldVarType ? <> ({fieldVarType})</> : null}{agent ? <> on agent <span className="font-medium">{agent.name}</span></> : null}. Budget {FAQ_FIELD_BUDGET.toLocaleString()} characters; {composed.chars.toLocaleString()} used by {composed.included.length} {composed.included.length === 1 ? "answer" : "answers"}.
                  {composed.dropped.length ? (
                    <span data-testid="brief-dropped"> {composed.dropped.length} over the budget, dropped whole, lowest-ranked first: {composed.dropped.map((e) => e.question).join("; ")}</span>
                  ) : null}
                </dd>
                {reads ? (
                  <dd className="mt-1 text-xs" data-testid="agent-reads">
                    Your bot reads: {reads.reads.length ? reads.reads.map((f) => <code key={f} className="mr-1">{f}</code>) : "none of these fields"}.
                    {!fieldRead ? <span className="ml-1 rounded bg-warn-soft px-1 text-warn" data-testid="agent-not-read">{notReadWarning(field)}, so nothing is sent until the agent&apos;s prompt carries its token.</span> : null}
                  </dd>
                ) : token ? (
                  <dd className="mt-1 text-xs text-warn" data-testid="agent-unread">Couldn&apos;t read your bot&apos;s agent from Community Loyalty just now.</dd>
                ) : null}
              </div>
            </dl>
          </Card>

          {approved.length ? (
            <Card title={`Approved · ${approved.length}`}>
              <ul className="space-y-3" data-testid="approved">
                {approved.map((e) => (
                  <EntryRow key={e.id} e={e} />
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title="Log">
            {syncs.length ? (
              <ul className="mb-3 space-y-1 text-xs" data-testid="sync-log">
                {syncs.map((x) => (
                  <li key={x.id} data-status={x.status}>
                    {formatDateTime(x.createdAt, v.workspace.timezone)} · {x.status} · {x.entryCount} answers, {x.chars.toLocaleString()} chars{x.dropped.length ? `, ${x.dropped.length} dropped` : ""} · value {x.valueReadBack ? "read back" : "not read back"}, token {x.tokenReadBack ? "present" : "not confirmed"} · by {x.sentBy ?? "—"}{x.note ? ` · ${x.note}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            {log.length ? (
              <ul className="space-y-1 text-xs text-ink-2" data-testid="faq-log">
                {log.map((ev) => (
                  <li key={ev.id} data-event={ev.event}>
                    {formatDateTime(ev.createdAt, v.workspace.timezone)} · {ev.event.replace("faq.", "")} · {String((ev.payload as Record<string, unknown>).question ?? (ev.payload as Record<string, unknown>).entries ?? "")} · {ev.note ?? ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-3">Nothing yet.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/** One entry: its words, its mark, Accept for this one (never more), Edit first, Remove. */
function EntryRow({ e, pinned = false }: { e: FaqEntry; pinned?: boolean }) {
  const unreviewed = isUnreviewed(e.origin);
  return (
    <li id={`faq-${e.id}`} className={`rounded-lg border p-3 text-sm ${pinned ? "border-warn bg-warn-soft" : "border-line"}`} data-testid="faq-entry" data-origin={e.origin} data-eyes={pinned ? "1" : "0"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium" data-testid="faq-question">{e.question}</p>
          <p className="mt-1 whitespace-pre-line text-ink-2" data-testid="faq-answer">{e.answer}</p>
          <p className="mt-1 text-[11px] text-ink-3">{e.category ? <Badge>{e.category}</Badge> : null} {e.alsoAsked.length ? `Also asked: ${e.alsoAsked.join(" / ")}` : ""}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {unreviewed ? (
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-warn bg-warn-soft px-2 py-0.5 text-xs font-medium">{UNREVIEWED_LABEL}</span>
              <form action={acceptFaqAction}>
                <input type="hidden" name="id" value={e.id} />
                <SubmitButton className="btn btn-ghost btn-xs" data-testid="faq-accept" pendingText="Accepting…">{ACCEPT_LABEL}</SubmitButton>
              </form>
            </div>
          ) : (
            <Badge tone="good">{e.origin === "edited" ? "edited" : "approved"}</Badge>
          )}
          <form action={deleteFaqAction}>
            <input type="hidden" name="id" value={e.id} />
            <ConfirmDelete verb="Remove" what="this answer" undo="It stays on your bot until you next send, then it is gone from there too." label="Remove" className="btn btn-ghost btn-xs text-danger" testId="faq-remove" />
          </form>
        </div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-ink-3">Edit first</summary>
        <form action={updateFaqAction} className="mt-2 space-y-1 text-xs" data-testid="faq-edit">
          <input type="hidden" name="id" value={e.id} />
          <input className="field" name="question" defaultValue={e.question} data-testid="faq-edit-question" />
          <textarea className="field min-h-20" name="answer" defaultValue={e.answer} data-testid="faq-edit-answer" />
          <div className="flex gap-1">
            <input className="field flex-1" name="category" defaultValue={e.category} placeholder="Category" />
            <input className="field flex-1" name="alsoAsked" defaultValue={e.alsoAsked.join(", ")} placeholder="Also asked, comma-separated" />
            <input className="field flex-1" name="keywords" defaultValue={e.keywords.join(", ")} placeholder="Keywords" />
          </div>
          <SubmitButton className="btn btn-soft btn-xs" data-testid="faq-edit-save" pendingText="Saving…">Save</SubmitButton>
        </form>
      </details>
    </li>
  );
}
