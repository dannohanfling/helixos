import Link from "next/link";
import type { schema } from "@/db";
import { approveBotLineAction, pushYourBotAction, saveBotLinesAction } from "@/lib/actions/your-bot";
import type { Stage1Preview } from "@/lib/community-loyalty";
import { NOTHING_CURRENT_LABEL, PAYMENT_PLAN_LINE_DEFAULT, PRICE_ANSWER_DEFAULT, PRICE_MODES, PRICE_MODE_LABEL, PRODUCT_FIELD, botNameOf, botOffers, nothingToPushLine, paymentPlanLineOf, priceAnswerFor, refundLineOf, suggestCoverageLine, type PlanRow, type Stage1Field } from "@/lib/engine/bot-fields";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card } from "@/components/ui";

const STATUS_LABEL = { change: "will change", same: "unchanged", empty: "nothing in HelixOS", missing: "not on the bot", unread: "not read by any agent" } as const;
const STATUS_TONE = { change: "accent", same: "neutral", empty: "warn", missing: "warn", unread: "warn" } as const;

/** Each bot field under a plain name, in the order the agent uses them, and where its words are changed. */
const GROUPS: { field: Stage1Field; name: string; edit: string }[] = [
  { field: "ai_persona_role_cbf", name: "Who it speaks as", edit: "/essence?step=identity" },
  { field: "ai_constraints_cbf", name: "House rules", edit: "/essence?step=guidelines_to_respond" },
  { field: PRODUCT_FIELD, name: "What it sells", edit: "" },
  { field: "qualifying_question_1", name: "Question 1", edit: "/settings#your-bot" },
  { field: "qualifying_question_2", name: "Question 2", edit: "/settings#your-bot" },
  { field: "qualifying_question_3", name: "Question 3", edit: "/settings#your-bot" },
  { field: "business_time_zone_cbf", name: "Time zone", edit: "/settings#you" },
  { field: "business_name_cbf", name: "Business name", edit: "/settings#you" },
];

/** Where a section of the offers field is changed. */
const sectionEdit = (key: string): string => (key === "what" ? "/settings#your-bot" : key === "price" || key === "guarantee" ? "#lines" : key.startsWith("offer:") ? `/offers/${key.slice("offer:".length)}#bot` : "/offers");

/**
 * The "Your bot" panel (handoff rev 77, 78 and 80): a summary of exactly what will be sent, grouped by the bot field it composes
 * into, not a second place to edit, except the lines that exist only for the bot. Then Needs your eyes, the sample replies, the
 * checks, the steps that stay manual in Community Loyalty, and one Push. The member sees it for their own bot; their coach sees
 * the same panel for any member's.
 */
export function YourBotPanel({ m, preview, own, whose, sp, lastPushedLine }: { m: schema.Membership; preview: Stage1Preview; own: boolean; whose: string; sp: { pushed?: string; changed?: string; failed?: string; note?: string; saved?: string }; lastPushedLine: string }) {
  const rowOf = new Map(preview.rows.map((r) => [r.field, r]));
  const sending = preview.rows.filter((r) => r.status === "change");
  const c = preview.input.coach ?? {};
  const offers = botOffers(preview.input.offers);
  const payer = offers.find((o) => o.botRole === "core" && o.paymentLink) ?? offers.find((o) => o.botRole === "entry" && o.paymentLink);
  const samples: [string, string][] = [
    ["How much is it?", c.priceMode === "range" ? c.rangeLine?.trim() || "(no range line yet)" : c.priceMode === "never" ? priceAnswerFor(c.priceAnswer) : offers.length ? offers.map((o) => `${botNameOf(o)}: ${o.currency} ${o.price.toLocaleString()}`).join(". ") : "(no offer on your bot yet)"],
    ["Is there a guarantee?", c.guaranteeLine?.trim() || "(no guarantee: your bot says nothing about results)"],
    ["I'm ready, where do I pay?", payer ? `Here's the link for ${botNameOf(payer)}: ${payer.paymentLink}. ${refundLineOf(payer)}`.trim() : "(no offer on your bot takes payment in chat, so it books a call)"],
  ];
  const edit = (href: string) => (own && href ? <Link href={href} className="text-xs underline" data-testid="bot-element-edit">Edit</Link> : href ? <span className="text-[11px] text-ink-3">edited by them</span> : null);

  return (
    <div className="space-y-4" id="your-bot">
      {sp.pushed ? <p className="rounded-xl border border-good bg-good-soft p-3 text-sm" data-testid="bot-pushed" role="status">Pushed {sp.pushed} {sp.pushed === "1" ? "field" : "fields"} and read each one back. Below is what {whose} holds now.</p> : null}
      {sp.changed ? <p className="rounded-xl border border-warn bg-warn-soft p-3 text-sm" data-testid="bot-push-changed" role="status">The bot or the record changed since the page was read. Here is the new before-and-after; nothing was sent.</p> : null}
      {sp.failed ? <p className="rounded-lg border border-danger bg-danger-soft p-2 text-sm font-medium" data-testid="bot-push-failed" role="alert">{sp.failed}</p> : null}
      {sp.note ? <p className="rounded-lg bg-surface-2 p-2 text-sm" data-testid="bot-push-note" role="status">{sp.note}</p> : null}

      <Card title="What your bot will be sent" action={preview.agentNames.length ? <span className="text-xs text-ink-3" data-testid="bot-agents">Agents on this bot: {preview.agentNames.join(", ")}</span> : null}>
        <div data-testid="bot-preview">
          <p className="mb-2 text-xs text-ink-3" data-testid="bot-last-pushed">{lastPushedLine}</p>
          {preview.blocked ? <p className="mb-2 rounded-lg bg-warn-soft p-2 text-sm" data-testid="bot-preview-blocked">{preview.blocked}</p> : null}
          {preview.rows.filter((r) => r.fallback).map((r) => (
            <p key={r.field} className="mb-2 rounded-lg bg-warn-soft p-2 text-sm" data-testid="bot-fallback">
              This bot has no {r.field} field that an agent reads, so the offers go into {r.name}, the older name for it. Rename the field on the bot when you can; the push follows the new name as soon as an agent reads it.
            </p>
          ))}
          <ul className="divide-y">
            {GROUPS.map((g) => {
              const r: PlanRow | undefined = rowOf.get(g.field);
              return (
                <li key={g.field} className="py-3 text-sm" data-testid="bot-field-row" data-field={g.field} data-status={r?.status ?? "unknown"}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{g.name}</span>
                    {r ? <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> : null}
                    {r?.readBy.length ? <span className="text-[11px] text-ink-3" data-testid="bot-field-readby">read by {r.readBy.join(", ")}</span> : null}
                    {g.field !== PRODUCT_FIELD ? edit(g.edit) : null}
                  </div>
                  <code className="text-[11px] text-ink-3">{r?.name ?? g.field}</code>
                  {r?.line ? <p className="mt-1 text-xs text-ink-3" data-testid="bot-field-line">{r.line}</p> : null}
                  {g.field === PRODUCT_FIELD ? (
                    <ul className="mt-2 space-y-2 border-l pl-3" data-testid="bot-sections">
                      {preview.sections.length ? (
                        preview.sections.map((s) => {
                          const held = r?.current ?? "";
                          const status = !r || r.status === "unread" || r.status === "missing" ? r?.status ?? "unknown" : held.includes(s.text) ? "same" : "change";
                          return (
                            <li key={s.key} data-testid="bot-section" data-section={s.key} data-status={status}>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{s.title}</span>
                                {status in STATUS_LABEL ? <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE]}>{STATUS_LABEL[status as keyof typeof STATUS_LABEL]}</Badge> : null}
                                {edit(sectionEdit(s.key))}
                              </div>
                              <details className="mt-1">
                                <summary className="cursor-pointer truncate text-xs text-ink-2">{s.text.split("\n")[1] ?? s.text}</summary>
                                <p className="mt-1 whitespace-pre-line rounded bg-accent-soft p-2 text-xs">{s.text}</p>
                              </details>
                            </li>
                          );
                        })
                      ) : (
                        <li className="text-xs text-ink-3">No offer has a role on your bot yet, and there is no &ldquo;What I do&rdquo;. Give an offer a role on its page to put it on your bot.</li>
                      )}
                    </ul>
                  ) : null}
                  {r?.status === "change" ? (
                    <details className="mt-2" open={g.field !== PRODUCT_FIELD}>
                      <summary className="cursor-pointer text-xs text-ink-3">Now and after the push</summary>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-ink-3">On the bot now</div>
                          <p className="whitespace-pre-line rounded bg-surface-2 p-2 text-xs" data-testid="bot-field-before">{r.current?.trim() ? r.current : "(empty)"}</p>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-ink-3">After the push</div>
                          <p className="whitespace-pre-line rounded bg-accent-soft p-2 text-xs" data-testid="bot-field-after">{r.nothing ? NOTHING_CURRENT_LABEL[r.field] : r.next}</p>
                        </div>
                      </div>
                    </details>
                  ) : null}
                  {r?.status === "same" && !r.nothing && g.field !== PRODUCT_FIELD ? <p className="mt-1 whitespace-pre-line rounded bg-surface-2 p-2 text-xs text-ink-2" data-testid="bot-field-same">{r.next}</p> : null}
                </li>
              );
            })}
            <li className="py-3 text-sm">
              <span className="font-semibold">FAQ answers</span> <span className="text-xs text-ink-3">approved and sent on their own{own ? <>, <a href="#faq" className="underline">below</a></> : null}.</span>
            </li>
          </ul>
        </div>
      </Card>

      <Card title="Needs your eyes" action={<span className="text-xs text-ink-3">{preview.eyes.filter((e) => e.approved).length} of {preview.eyes.length} approved</span>}>
        <div id="eyes" data-testid="bot-eyes">
          <p className="mb-2 text-xs text-ink-3">Every price, deposit, term, link and guarantee your bot will say, word for word. Each is approved on its own; a changed line needs approving again. Nothing is pushed until all are approved.</p>
          {preview.eyes.length ? (
            <ul className="space-y-2">
              {preview.eyes.map((e) => (
                <li key={e.line.key} className="rounded-lg border p-2 text-sm" data-testid="eyes-row" data-key={e.line.key} data-approved={e.approved ? "yes" : "no"}>
                  <div className="text-xs font-medium text-ink-2">{e.line.label}</div>
                  <p className="mt-1 whitespace-pre-line break-words" data-testid="eyes-text">
                    {e.line.key.endsWith(".link") ? <a href={e.line.text} target="_blank" rel="noreferrer" className="underline">{e.line.text}</a> : e.line.text}
                  </p>
                  {e.approved ? (
                    <span className="mt-1 inline-block text-xs text-good" data-testid="eyes-approved">Approved</span>
                  ) : (
                    <form action={approveBotLineAction} className="mt-1">
                      <input type="hidden" name="membershipId" value={m.id} />
                      <input type="hidden" name="key" value={e.line.key} />
                      <SubmitButton className="btn btn-soft btn-xs" pendingText="Approving…" data-testid="eyes-approve">
                        Approve this line
                      </SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2" data-testid="eyes-none">Nothing to approve: no price, deposit, term, link or guarantee is on your bot yet.</p>
          )}
        </div>
      </Card>

      <Card title="Lines only your bot has">
        <form action={saveBotLinesAction} className="space-y-3" id="lines" data-testid="bot-lines">
          <input type="hidden" name="membershipId" value={m.id} />
          {sp.saved ? <p className="rounded-lg bg-good-soft p-2 text-xs" data-testid="bot-lines-saved">Saved. Changed lines need approving again.</p> : null}
          <label className="block text-sm">
            How it handles price
            <select className="field mt-1" name="priceMode" defaultValue={c.priceMode ?? "full"} data-testid="bot-price-mode">
              {PRICE_MODES.map((p) => (
                <option key={p} value={p}>
                  {PRICE_MODE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            The range, when asked about price
            <input className="field mt-1" name="rangeLine" defaultValue={c.rangeLine ?? ""} placeholder="Sure. It depends on what you need. Some start at …, and some work with me for up to …" data-testid="bot-range-line" />
          </label>
          <label className="block text-sm">
            When asked about payment plans
            <input className="field mt-1" name="paymentPlanLine" defaultValue={c.paymentPlanLine ?? ""} placeholder={PAYMENT_PLAN_LINE_DEFAULT} data-testid="bot-plan-line" />
          </label>
          <label className="block text-sm">
            Instead of a price (when it never talks price)
            <input className="field mt-1" name="priceAnswer" defaultValue={c.priceAnswer ?? ""} placeholder={PRICE_ANSWER_DEFAULT} data-testid="bot-price-answer" />
          </label>
          <label className="block text-sm">
            Your guarantee, as your bot says it, word for word
            <textarea className="field mt-1" name="guaranteeLine" rows={3} defaultValue={c.guaranteeLine ?? ""} placeholder="Leave empty for no guarantee on your bot." data-testid="bot-guarantee-line" />
          </label>
          <label className="block text-sm">
            What the guarantee covers
            <textarea className="field mt-1" name="guaranteeCoverageLine" rows={2} defaultValue={c.guaranteeCoverageLine ?? ""} placeholder={suggestCoverageLine(preview.input.offers) || "Mark the covered offers on their pages for a suggestion."} data-testid="bot-coverage-line" />
          </label>
          <p className="text-xs text-ink-3">The payment plan line uses &ldquo;{paymentPlanLineOf(c)}&rdquo; while its box is empty.</p>
          <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="bot-lines-save">
            Save these lines
          </SubmitButton>
        </form>
      </Card>

      <Card title="Sample replies">
        <p className="mb-2 text-xs text-ink-3">What your bot is told to say to each; it puts the reply in its own words, in your voice.</p>
        <dl className="space-y-2 text-sm" data-testid="bot-samples">
          {samples.map(([q, a]) => (
            <div key={q}>
              <dt className="font-medium">&ldquo;{q}&rdquo;</dt>
              <dd className="text-ink-2" data-testid="bot-sample">{a}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Before you push">
        <div data-testid="bot-checks">
          {preview.holds.map((h) => <p key={h} className="mb-1 rounded bg-danger-soft p-2 text-sm" data-testid="bot-hold">{h}</p>)}
          {preview.warnings.map((w) => <p key={w} className="mb-1 rounded bg-warn-soft p-2 text-sm" data-testid="bot-warning">{w}</p>)}
          {!preview.holds.length && !preview.warnings.length ? <p className="text-sm text-ink-2">Nothing stops this push.</p> : null}
          <p className="mb-1 mt-3 text-xs font-medium text-ink-2">Steps that stay manual in Community Loyalty, read from your bot just now:</p>
          <ul className="space-y-0.5 text-xs">
            {GROUPS.filter((g) => g.field !== "business_name_cbf").map((g) => {
              const r = rowOf.get(g.field);
              return (
                <li key={g.field} data-testid="manual-step" data-field={g.field} data-read={r?.readBy.length ? "yes" : "no"}>
                  {r?.readBy.length ? `✓ ${r.readBy.join(" and ")} ${r.readBy.length === 1 ? "reads" : "read"} your ${g.name.toLowerCase()}.` : `✗ No agent reads your ${g.name.toLowerCase()} yet: add it to your Booking Agent's prompt in Community Loyalty.`}
                </li>
              );
            })}
          </ul>
          {!preview.blocked && sending.length ? (
            <form action={pushYourBotAction} className="mt-3 flex flex-wrap items-center gap-3">
              <input type="hidden" name="membershipId" value={m.id} />
              <input type="hidden" name="key" value={preview.key} />
              <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending to your bot…" data-testid="push-stage1" disabled={preview.holds.length > 0}>
                Push {sending.length} {sending.length === 1 ? "change" : "changes"} to the bot
              </SubmitButton>
              <span className="text-xs text-ink-3">{preview.holds.length ? "Clear what is in red above first." : "Only the fields marked “will change” are sent, and each is read back."}</span>
            </form>
          ) : !preview.blocked ? (
            <p className="mt-3 text-sm text-ink-2" data-testid="bot-nothing-to-push">{nothingToPushLine(preview.rows)}</p>
          ) : null}
          <p className="mt-3 text-xs text-ink-3">Never touched: the calendar {own ? "you" : "they"} chose, and what the agent writes when it books.</p>
        </div>
      </Card>
    </div>
  );
}
