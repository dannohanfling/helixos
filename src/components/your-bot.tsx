import Link from "next/link";
import type { schema } from "@/db";
import { approveBotLineAction, deleteBotExampleAction, deleteBotStoryAction, pushYourBotAction, saveBotExampleAction, saveBotLinesAction, saveBotStoryAction, setBotPricesAction } from "@/lib/actions/your-bot";
import type { Stage1Preview } from "@/lib/community-loyalty";
import { DEFAULT_PATHS, DEFAULT_PATH_LABEL, NOTHING_CURRENT_LABEL, PRICE_ANSWER_DEFAULT, PRODUCT_FIELD, botNameOf, botOffers, exampleWarnings, nothingToPushLine, peopleWordOf, priceAnswerFor, pricedExample, pricesOff, refundLineOf, type PlanRow, type Stage1Field } from "@/lib/engine/bot-fields";
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
const SECTION_EDIT: Record<string, string> = { what: "/settings#your-bot", money: "#lines", facts: "#lines", examples: "#examples", stories: "#stories", partners: "/proof", one_on_one: "/offers" };
const sectionEdit = (key: string): string => SECTION_EDIT[key] ?? "/offers";

/**
 * The "Your bot" panel (handoff rev 77, 78 and 80): a summary of exactly what will be sent, grouped by the bot field it composes
 * into, not a second place to edit, except the lines that exist only for the bot. Then Needs your eyes, the sample replies, the
 * checks, the steps that stay manual in Community Loyalty, and one Push. The member sees it for their own bot; their coach sees
 * the same panel for any member's.
 */
export function YourBotPanel({ m, preview, own, whose, sp, lastPushedLine }: { m: schema.Membership; preview: Stage1Preview; own: boolean; whose: string; sp: { pushed?: string; changed?: string; failed?: string; note?: string; saved?: string; exampleMissing?: string; storyMissing?: string }; lastPushedLine: string }) {
  const rowOf = new Map(preview.rows.map((r) => [r.field, r]));
  const sending = preview.rows.filter((r) => r.status === "change");
  const c = preview.input.coach ?? {};
  const offers = botOffers(preview.input.offers);
  const off = pricesOff(c);
  // With prices off no link goes out and everyone gets the call, so the samples say that instead of a link.
  const payer = off ? undefined : offers.find((o) => (o.botRole === "entry" || o.botRole === "core") && o.paymentLink);
  const call = `the ${c.callMinutes ? `${c.callMinutes}-minute ` : ""}call`;
  const guarantee = c.guaranteeLine?.trim() ? [c.guaranteeLeadIn?.trim(), c.guaranteeLine.trim()].filter(Boolean).join(" ") : "";
  const samples: [string, string][] = [
    ["How much is it?", `${priceAnswerFor(c.priceAnswer)} Then a question about what they need.`],
    ["Is there a guarantee?", guarantee || "(no guarantee: your bot says nothing about results)"],
    ["Yes, send me the link.", off ? `(prices are off: no link, it offers ${call})` : payer ? `Here's the link for ${botNameOf(payer)}: ${payer.paymentLink}.` : "(no offer on your bot takes payment in chat, so it books a call)"],
    ["I'd feel weird paying before we talk.", off ? `(prices are off: it offers ${call})` : payer && refundLineOf(payer) ? `We can talk first, or ${refundLineOf(payer)}` : "(no refund on your bot: it offers the call)"],
  ];
  const examples = m.botExamples;
  const stories = m.botStories;
  const partners = c.partnerStories ?? [];
  const word = peopleWordOf(c);
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
          <p className="mb-2 text-xs text-ink-3">Every fact your bot knows (prices, terms, links, the refund, the call, the guarantee) and every story it may tell as true, word for word. Each is approved on its own; a changed line needs approving again. Nothing is pushed until all are approved.</p>
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
            <p className="text-sm text-ink-2" data-testid="eyes-none">Nothing to approve: no fact or story is on your bot yet.</p>
          )}
        </div>
      </Card>

      <Card title="Prices on your bot" action={<Badge tone={off ? "warn" : "neutral"}>{off ? "off" : "on"}</Badge>}>
        <form action={setBotPricesAction} className="flex flex-wrap items-center gap-3" id="prices" data-testid="bot-prices" data-on={off ? "no" : "yes"}>
          <input type="hidden" name="membershipId" value={m.id} />
          <input type="hidden" name="prices" value={off ? "on" : "off"} />
          <p className="flex-1 text-sm text-ink-2">
            {off
              ? `Off: your bot gives no amount, range or payment terms, sends no checkout link and names no program. Everyone who is a fit gets ${call}. Your guarantee promise, and a refund line with no amount, still go.`
              : "On: your bot shares your prices, terms and links once the conversation gets there, the way your facts and examples say."}
          </p>
          <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="bot-prices-toggle">
            {off ? "Turn prices on" : "Turn prices off"}
          </SubmitButton>
          <p className="w-full text-xs text-ink-3">Nothing is sent until you push. Examples with a price or an offer&apos;s name are left out while prices are off, and come back when they&apos;re on.</p>
        </form>
      </Card>

      <Card title="Facts and money: lines only your bot has">
        <form action={saveBotLinesAction} className="space-y-3" id="lines" data-testid="bot-lines">
          <input type="hidden" name="membershipId" value={m.id} />
          {sp.saved ? <p className="rounded-lg bg-good-soft p-2 text-xs" data-testid="bot-lines-saved">Saved. Changed lines need approving again.</p> : null}
          <p className="text-xs text-ink-3">Your bot knows these and shares one only when the conversation gets there. Each offer&apos;s terms, link, cancelling and refund are on the offer&apos;s own page.</p>
          <label className="block text-sm">
            When someone asks the price early, before you know their situation: no numbers
            <input className="field mt-1" name="priceAnswer" defaultValue={c.priceAnswer ?? ""} placeholder={PRICE_ANSWER_DEFAULT} data-testid="bot-price-answer" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              After your questions, most people get
              <select className="field mt-1" name="defaultPath" defaultValue={c.defaultPath ?? "call"} data-testid="bot-default-path">
                {DEFAULT_PATHS.map((p) => (
                  <option key={p} value={p}>
                    {DEFAULT_PATH_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              The call, in minutes
              <input className="field mt-1 tabular" name="callMinutes" type="number" min={1} defaultValue={c.callMinutes ?? ""} placeholder="15" data-testid="bot-call-minutes" />
            </label>
          </div>
          <label className="block text-sm">
            The one-on-one range, as a fact (only the contrast when recommending, never the answer to an early price question)
            <input className="field mt-1" name="oneOnOneRange" defaultValue={c.oneOnOneRange ?? ""} placeholder="$25,000 to $50,000 a year" data-testid="bot-one-on-one-range" />
          </label>
          <label className="block text-sm">
            Payment plans, only if asked: what your bot does
            <textarea className="field mt-1" name="paymentPlanLine" rows={2} defaultValue={c.paymentPlanLine ?? ""} placeholder="Leave empty and your bot never talks about payment plans." data-testid="bot-plan-line" />
          </label>
          <label className="block text-sm">
            Your guarantee, the promise your bot says word for word
            <textarea className="field mt-1" name="guaranteeLine" rows={3} defaultValue={c.guaranteeLine ?? ""} placeholder="Leave empty for no guarantee on your bot." data-testid="bot-guarantee-line" />
          </label>
          <label className="block text-sm">
            A lead-in before it (optional, free words)
            <input className="field mt-1" name="guaranteeLeadIn" defaultValue={c.guaranteeLeadIn ?? ""} placeholder="If you're putting skin in the game, I put skin in the game too." data-testid="bot-guarantee-lead-in" />
          </label>
          <label className="block text-sm">
            What you call the people you work with
            <input className="field mt-1" name="peopleWord" defaultValue={c.peopleWord ?? ""} placeholder="clients" data-testid="bot-people-word" />
          </label>
          <p className="text-xs text-ink-3">What the guarantee covers is composed from the &ldquo;covered&rdquo; tick on each offer, and said only when an offer on your bot isn&apos;t covered.</p>
          <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="bot-lines-save">
            Save these lines
          </SubmitButton>
        </form>
      </Card>

      <Card title="How you say it" action={<span className="text-xs text-ink-3">{examples.length} examples</span>}>
        <div id="examples" data-testid="bot-examples">
          <p className="mb-2 text-xs text-ink-3">Short examples from your own chats. Your bot matches the tone and the order and never copies them word for word. No approval needed. A normal message is two sentences at most; an objection up to four: acknowledge them, a story if one fits, the answer, then one question.</p>
          {sp.exampleMissing ? <p className="mb-2 rounded-lg bg-warn-soft p-2 text-xs" role="alert">An example needs the moment and what you say.</p> : null}
          <ul className="space-y-2">
            {examples.map((e) => (
              <li key={e.id} className="rounded-lg border p-2 text-sm" data-testid="bot-example" data-kind={e.kind}>
                <details>
                  <summary className="cursor-pointer">
                    <span className="font-medium">{e.moment}</span> <Badge tone={e.kind === "objection" ? "warn" : "neutral"}>{e.kind}</Badge>
                    {exampleWarnings(e).map((w) => <span key={w} className="ml-2 text-xs text-warn" data-testid="bot-example-warning">{w}</span>)}
                    {off && pricedExample(e, preview.input.offers) ? <span className="ml-2 rounded bg-surface-2 px-1.5 text-xs text-ink-3" data-testid="bot-example-priced">left out while prices are off</span> : null}
                  </summary>
                  <ExampleForm m={m} e={e} />
                  <form action={deleteBotExampleAction} className="mt-1">
                    <input type="hidden" name="membershipId" value={m.id} />
                    <input type="hidden" name="id" value={e.id} />
                    <SubmitButton className="btn btn-ghost btn-xs" pendingText="Removing…">Remove</SubmitButton>
                  </form>
                </details>
              </li>
            ))}
          </ul>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm underline" data-testid="bot-example-add">Add an example</summary>
            <ExampleForm m={m} />
          </details>
        </div>
      </Card>

      <Card title="Your stories" action={<span className="text-xs text-ink-3">{stories.length} stories</span>}>
        <div id="stories" data-testid="bot-stories">
          <p className="mb-2 text-xs text-ink-3">True stories from your own life. Your bot tells only these, may shorten one and never adds to it: at most one plain story a chat, a belief story whenever its belief comes up, never more than two. Each is approved in Needs your eyes. No results or dollar figures here: those are proof.</p>
          {sp.storyMissing ? <p className="mb-2 rounded-lg bg-warn-soft p-2 text-xs" role="alert">A story needs its words, and a belief story the belief it answers.</p> : null}
          <ul className="space-y-2">
            {stories.map((st) => (
              <li key={st.id} className="rounded-lg border p-2 text-sm" data-testid="bot-story" data-kind={st.kind}>
                <details>
                  <summary className="cursor-pointer">
                    {st.text} <Badge tone={st.kind === "belief" ? "accent" : "neutral"}>{st.kind === "belief" ? `belief: ${st.belief}` : "plain"}</Badge>
                  </summary>
                  <StoryForm m={m} st={st} />
                  <form action={deleteBotStoryAction} className="mt-1">
                    <input type="hidden" name="membershipId" value={m.id} />
                    <input type="hidden" name="id" value={st.id} />
                    <SubmitButton className="btn btn-ghost btn-xs" pendingText="Removing…">Remove</SubmitButton>
                  </form>
                </details>
              </li>
            ))}
          </ul>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm underline" data-testid="bot-story-add">Add a story</summary>
            <StoryForm m={m} />
          </details>
        </div>
      </Card>

      <Card title={`${word[0].toUpperCase()}${word.slice(1, -1)} stories, from your Proof Bank`} action={<span className="text-xs text-ink-3">{partners.length} on your bot</span>}>
        <div id="partners" data-testid="bot-partners">
          <p className="mb-2 text-xs text-ink-3">Real results, told only inside an objection, one a chat, as that person&apos;s own. Each comes from an approved proof (their permission ticked) that you put on your bot on its page, with its first name, what happened, and when it fits. Each is approved again here in Needs your eyes.</p>
          {partners.length ? (
            <ul className="space-y-1 text-sm">
              {partners.map((p) => (
                <li key={p.id} data-testid="bot-partner">
                  <Link href={`/proof/${p.id}#bot`} className="font-medium underline">{p.who}</Link>: {p.happened}{p.fits ? <span className="text-ink-3"> ({p.fits})</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">None yet. On an approved proof in <Link href="/proof" className="underline">your Proof Bank</Link>, tick &ldquo;On my bot&rdquo;.</p>
          )}
        </div>
      </Card>

      <Card title="Sample replies">
        <p className="mb-2 text-xs text-ink-3">What your bot knows for each; it puts the reply in its own words, in your voice, two sentences at most.</p>
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
          {preview.holds.map((h, i) => <p key={`${i}:${h}`} className="mb-1 rounded bg-danger-soft p-2 text-sm" data-testid="bot-hold">{h}</p>)}
          {preview.warnings.map((w, i) => <p key={`${i}:${w}`} className="mb-1 rounded bg-warn-soft p-2 text-sm" data-testid="bot-warning">{w}</p>)}
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

function ExampleForm({ m, e }: { m: schema.Membership; e?: schema.BotExampleRow }) {
  return (
    <form action={saveBotExampleAction} className="mt-2 space-y-2" data-testid="bot-example-form">
      <input type="hidden" name="membershipId" value={m.id} />
      <input type="hidden" name="id" value={e?.id ?? ""} />
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input className="field" name="moment" defaultValue={e?.moment ?? ""} placeholder="The moment: They ask the price first, nothing else." required />
        <select className="field" name="kind" defaultValue={e?.kind ?? "normal"}>
          <option value="normal">Normal: two sentences</option>
          <option value="objection">Objection: up to four</option>
        </select>
      </div>
      <input className="field" name="them" defaultValue={e?.them ?? ""} placeholder="What they say (optional)" />
      <textarea className="field" name="me" rows={2} defaultValue={e?.me ?? ""} placeholder="What you say" required />
      <SubmitButton className="btn btn-soft btn-xs" pendingText="Saving…">{e ? "Save" : "Add"}</SubmitButton>
    </form>
  );
}

function StoryForm({ m, st }: { m: schema.Membership; st?: schema.BotStoryRow }) {
  return (
    <form action={saveBotStoryAction} className="mt-2 space-y-2" data-testid="bot-story-form">
      <input type="hidden" name="membershipId" value={m.id} />
      <input type="hidden" name="id" value={st?.id ?? ""} />
      <textarea className="field" name="text" rows={2} defaultValue={st?.text ?? ""} placeholder="When I started, …" required />
      <div className="grid gap-2 sm:grid-cols-[auto_1fr_1fr]">
        <select className="field" name="kind" defaultValue={st?.kind ?? "plain"}>
          <option value="plain">Plain story</option>
          <option value="belief">Answers a belief</option>
        </select>
        <input className="field" name="when" defaultValue={st?.when ?? ""} placeholder="When it fits (plain)" />
        <input className="field" name="belief" defaultValue={st?.belief ?? ""} placeholder="The belief: I'm not techy" />
      </div>
      <SubmitButton className="btn btn-soft btn-xs" pendingText="Saving…">{st ? "Save" : "Add"}</SubmitButton>
    </form>
  );
}
