import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { pushStage1Action } from "@/lib/actions/integrations";
import { stage1Preview } from "@/lib/community-loyalty";
import { NOTHING_CURRENT_LABEL, nothingToPushLine } from "@/lib/engine/bot-fields";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Bot push" };

const STATUS_LABEL = { change: "will change", same: "unchanged", empty: "not sent", missing: "not on the bot", unread: "not sent" } as const;
const STATUS_TONE = { change: "accent", same: "neutral", empty: "warn", missing: "warn", unread: "warn" } as const;

/**
 * What a Stage 1 push would change on one member's bot, before anything is sent: per field, what the bot holds now against what
 * HelixOS would write. The page reads the bot live; the push button carries the key of exactly this plan, so what is sent is what
 * is shown here. A client's bot or the coach's own, the same page.
 */
export default async function BotPushPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ pushed?: string; changed?: string; failed?: string; note?: string }> }) {
  const v = await requireCoach();
  const { clientId } = await params;
  const sp = await searchParams;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, clientId), eq(schema.memberships.workspaceId, v.workspace.id)) });
  if (!m) notFound();
  const own = m.id === v.membership.id;
  const u = own ? v.user : await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  if (!u) notFound();
  const preview = await stage1Preview(m);
  const sending = preview.rows.filter((r) => r.status === "change");
  const fallbacks = preview.rows.filter((r) => r.fallback);
  const whose = own ? "your bot" : `${u.name}'s bot`;

  return (
    <>
      <PageHeader title={`What a push would change on ${whose}`} subtitle="Read from the bot just now. Nothing is sent until you press the button below." action={<Link href={own ? "/coach" : `/coach/${m.id}`} className="btn btn-ghost btn-sm">Back</Link>} />
      {sp.pushed ? (
        <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" data-testid="bot-pushed" role="status">
          Pushed {sp.pushed} {sp.pushed === "1" ? "field" : "fields"} and read each one back. Below is what {whose} holds now.
        </p>
      ) : null}
      {sp.changed ? (
        <p className="mb-4 rounded-xl border border-warn bg-warn-soft p-3 text-sm" data-testid="bot-push-changed" role="status">
          The bot or the record changed since the page was read. Here is the new before-and-after; nothing was sent.
        </p>
      ) : null}
      {sp.failed ? (
        <p className="mb-4 rounded-lg border border-danger bg-danger-soft p-2 text-sm font-medium" data-testid="bot-push-failed" role="alert">
          {sp.failed}
        </p>
      ) : null}
      {sp.note ? (
        <p className="mb-4 rounded-lg bg-surface-2 p-2 text-sm" data-testid="bot-push-note" role="status">
          {sp.note}
        </p>
      ) : null}
      <Card title="Business facts" action={preview.agentNames.length ? <span className="text-xs text-ink-3" data-testid="bot-agents">Agents on this bot: {preview.agentNames.join(", ")}</span> : null}>
        <div data-testid="bot-preview">
          {preview.blocked ? (
            <p className="rounded-lg bg-warn-soft p-2 text-sm" data-testid="bot-preview-blocked">
              {preview.blocked}
            </p>
          ) : (
            <>
              {fallbacks.map((r) => (
                <p key={r.field} className="mb-2 rounded-lg bg-warn-soft p-2 text-sm" data-testid="bot-fallback">
                  This bot has no {r.field} field, so the offers go into {r.name}, the older name for it. Rename the field on the bot when you can; the push follows the new name as soon as it is there.
                </p>
              ))}
              {preview.pricesLeftOut.length ? (
                <p className="mb-2 text-sm text-ink-2" data-testid="bot-prices-left-out">
                  Never quote prices is ticked on {preview.pricesLeftOut.join(", ")}, so {preview.pricesLeftOut.length === 1 ? "its price is" : "their prices are"} left out of what is sent.
                </p>
              ) : null}
              <ul className="divide-y">
                {preview.rows.map((r) => (
                  <li key={r.field} className="py-3 text-sm" data-testid="bot-field-row" data-field={r.field} data-status={r.status}>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-xs font-semibold">{r.name ?? r.field}</code>
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      {r.readBy.length ? <span className="text-[11px] text-ink-3" data-testid="bot-field-readby">read by {r.readBy.join(", ")}</span> : null}
                    </div>
                    {r.line ? <p className="mt-1 text-xs text-ink-3" data-testid="bot-field-line">{r.line}</p> : null}
                    {r.status === "change" ? (
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
                    ) : null}
                    {r.status === "same" && !r.nothing ? <p className="mt-1 whitespace-pre-line rounded bg-surface-2 p-2 text-xs text-ink-2" data-testid="bot-field-same">{r.next}</p> : null}
                  </li>
                ))}
              </ul>
              {sending.length ? (
                <form action={pushStage1Action} className="mt-3 flex flex-wrap items-center gap-3">
                  <input type="hidden" name="membershipId" value={m.id} />
                  <input type="hidden" name="key" value={preview.key} />
                  <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending to your bot…" data-testid="push-stage1">
                    Push {sending.length} {sending.length === 1 ? "change" : "changes"} to the bot
                  </SubmitButton>
                  <span className="text-xs text-ink-3">Only the fields marked &ldquo;will change&rdquo; are sent, and each is read back.</span>
                </form>
              ) : (
                <p className="mt-3 text-sm text-ink-2" data-testid="bot-nothing-to-push">{nothingToPushLine(preview.rows)}</p>
              )}
            </>
          )}
        </div>
      </Card>
      <p className="mt-3 text-xs text-ink-3">Never touched: the calendar the client chose, and what the agent writes when it books.</p>
    </>
  );
}
