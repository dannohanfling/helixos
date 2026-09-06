import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { CONTACT_STAGES } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { deleteContactAction, logMessageAction, updateContactAction } from "@/lib/actions/contacts";
import { CopyButton } from "@/components/copy-button";
import { TemplatePicker } from "@/components/template-picker";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { addDays, formatDateTime } from "@/lib/dates";
import { templatesFor } from "@/lib/queries/templates";
import { STAGE_META } from "@/lib/stage-meta";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const contact = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.id, id), eq(schema.contacts.userId, v.user.id)) });
  if (!contact) notFound();
  const [messages, templates] = await Promise.all([
    db.query.messages.findMany({ where: eq(schema.messages.contactId, id), orderBy: asc(schema.messages.sentAt) }),
    templatesFor(v.workspace.id),
  ]);
  const firstName = contact.name.split(" ")[0];
  const values = { Name: firstName, "Pass URL": "[Pass URL]", Points: "", Tier: "", "Points to Next Tier": "", "Specific Post Reference": "" };
  const waiting = Boolean(contact.lastInboundAt) && (!contact.lastOutboundAt || contact.lastInboundAt! > contact.lastOutboundAt);

  return (
    <>
      <PageHeader
        title={contact.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/conversations" className="hover:underline">
              ← Conversations
            </Link>
            <Badge tone={STAGE_META[contact.stage].tone}>{STAGE_META[contact.stage].label}</Badge>
            {waiting ? <Badge tone="warn">waiting on you</Badge> : null}
            <span>
              {contact.platform}
              {contact.profileUrl ? (
                <>
                  {" · "}
                  <a href={contact.profileUrl} target="_blank" rel="noreferrer" className="underline">
                    open profile ↗
                  </a>
                </>
              ) : null}
            </span>
          </span>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card title="Thread">
            {messages.length ? (
              <ul className="space-y-2">
                {messages.map((m) => (
                  <li key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${m.direction === "out" ? "bg-ink text-bg" : "bg-surface-2"}`}>
                      <div className="whitespace-pre-line">{m.body}</div>
                      <div className={`mt-1 text-[10px] ${m.direction === "out" ? "text-bg/70" : "text-ink-3"}`}>{formatDateTime(m.sentAt, v.workspace.timezone)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">No messages logged yet. Log the first one below.</p>
            )}
          </Card>
          <Card title="Log a message">
            <form action={logMessageAction} className="space-y-3">
              <input type="hidden" name="contactId" value={contact.id} />
              <div className="flex gap-2 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="direction" value="out" defaultChecked /> I sent
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="direction" value="in" /> They replied
                </label>
              </div>
              <TemplatePicker templates={templates} values={values} />
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Field label="Next follow-up (if I sent)">
                  <input className="field" name="nextFollowUpAt" type="date" defaultValue={addDays(v.today, 3)} />
                </Field>
                <div className="flex items-end">
                  <button className="btn btn-primary" type="submit">
                    Log it
                  </button>
                </div>
              </div>
            </form>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Where this stands">
            <form action={updateContactAction} className="space-y-3">
              <input type="hidden" name="id" value={contact.id} />
              <Field label="Stage">
                <select className="field" name="stage" defaultValue={contact.stage}>
                  {CONTACT_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_META[s].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Warmth">
                <select className="field" name="warmth" defaultValue={contact.warmth}>
                  <option value="cold">❄️ Cold</option>
                  <option value="warm">🌤 Warm</option>
                  <option value="hot">🔥 Hot</option>
                </select>
              </Field>
              <Field label="Next follow-up">
                <input className="field" name="nextFollowUpAt" type="date" defaultValue={contact.nextFollowUpAt ?? ""} />
              </Field>
              <Field label="Call booked for">
                <input className="field" name="callAt" type="datetime-local" defaultValue={contact.callAt ? contact.callAt.slice(0, 16) : ""} />
              </Field>
              <Field label="What they're building">
                <input className="field" name="whatTheyreBuilding" defaultValue={contact.whatTheyreBuilding ?? ""} />
              </Field>
              <Field label="Profile link">
                <input className="field" name="profileUrl" type="url" defaultValue={contact.profileUrl ?? ""} />
              </Field>
              <Field label="Notes">
                <textarea className="field min-h-20" name="notes" defaultValue={contact.notes ?? ""} placeholder="Pains, goals, what they've tried…" />
              </Field>
              <button className="btn btn-primary w-full" type="submit">
                Save
              </button>
            </form>
          </Card>
          <Card title="Quick copy">
            <div className="space-y-2">
              {templates.slice(0, 4).map((t) => (
                <div key={t.id} className="flex items-start justify-between gap-2 text-xs">
                  <span className="text-ink-2">{t.name}</span>
                  <CopyButton text={t.body.split("[Name]").join(firstName)} label="Copy" className="btn btn-ghost btn-xs" />
                </div>
              ))}
              <Link href="/conversations/playbook" className="block text-xs text-ink-2 hover:underline">
                Full playbook →
              </Link>
            </div>
          </Card>
          <form action={deleteContactAction}>
            <input type="hidden" name="id" value={contact.id} />
            <button className="text-xs text-ink-3 hover:text-danger" type="submit">
              Delete contact
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
