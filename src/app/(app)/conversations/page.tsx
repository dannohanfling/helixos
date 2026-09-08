import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CONTACT_PLATFORMS, type Contact } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { createContactAction, snoozeContactAction } from "@/lib/actions/contacts";
import { TemplatePicker } from "@/components/template-picker";
import { Badge, Card, Disclosure, Empty, Field, PageHeader, Tabs } from "@/components/ui";
import { templatesFor } from "@/lib/queries/templates";
import { addDays, relativeDay } from "@/lib/dates";
import { STAGE_META } from "@/lib/stage-meta";

export const metadata = { title: "Conversations" };


function waitingOnYou(c: Contact): boolean {
  return Boolean(c.lastInboundAt) && (!c.lastOutboundAt || c.lastInboundAt! > c.lastOutboundAt);
}

function ContactRow({ c, today }: { c: Contact; today: string }) {
  const due = c.nextFollowUpAt && c.nextFollowUpAt <= today && c.stage !== "cold" && c.stage !== "client";
  const waiting = waitingOnYou(c);
  return (
    <div className="flex items-center gap-3 px-2 py-2.5 hover:bg-surface-2">
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${c.warmth === "hot" ? "bg-danger-soft text-danger" : c.warmth === "warm" ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-ink-2"}`}>
        {c.name
          .split(" ")
          .map((p) => p[0])
          .slice(0, 2)
          .join("")}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/conversations/${c.id}`} className="truncate font-medium hover:underline">
            {c.name}
          </Link>
          <Badge tone={STAGE_META[c.stage].tone}>{STAGE_META[c.stage].label}</Badge>
          {waiting ? <Badge tone="warn">waiting on you</Badge> : null}
        </div>
        <div className="truncate text-xs text-ink-3">
          {c.platform}
          {c.whatTheyreBuilding ? ` · ${c.whatTheyreBuilding}` : ""}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs">
        {c.callAt ? <div className="font-semibold text-good">📞 {relativeDay(c.callAt.slice(0, 10), today)}</div> : null}
        {c.nextFollowUpAt && c.stage !== "cold" && c.stage !== "client" ? <div className={due ? "font-semibold text-warn" : "text-ink-3"}>follow up {relativeDay(c.nextFollowUpAt, today).toLowerCase()}</div> : null}
      </div>
      {due ? (
        <form action={snoozeContactAction} className="hidden sm:block">
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="days" value="1" />
          <button className="btn btn-ghost btn-xs" type="submit" title="Snooze to tomorrow">
            ↷
          </button>
        </form>
      ) : null}
    </div>
  );
}

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ filter?: string; new?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const filter = sp.filter ?? "due";
  const [contacts, templates] = await Promise.all([
    db.query.contacts.findMany({ where: eq(schema.contacts.userId, v.user.id), orderBy: [asc(schema.contacts.nextFollowUpAt), desc(schema.contacts.lastInboundAt)] }),
    templatesFor(v.workspace.id),
  ]);
  const active = contacts.filter((c) => c.stage !== "cold" && c.stage !== "client");
  const due = active.filter((c) => c.nextFollowUpAt && c.nextFollowUpAt <= v.today);
  const inbound = active.filter(waitingOnYou);
  const attention = [...inbound, ...due.filter((c) => !inbound.some((i) => i.id === c.id))];
  const pipeline = active;
  const clients = contacts.filter((c) => c.stage === "client");
  const cold = contacts.filter((c) => c.stage === "cold");
  const tabs = [
    { key: "due", label: "Needs you", href: "/conversations", count: attention.length },
    { key: "pipeline", label: "Pipeline", href: "/conversations?filter=pipeline", count: pipeline.length },
    { key: "clients", label: "Clients", href: "/conversations?filter=clients", count: clients.length },
    { key: "cold", label: "Cold", href: "/conversations?filter=cold", count: cold.length },
  ];
  const list = filter === "pipeline" ? pipeline : filter === "clients" ? clients : filter === "cold" ? cold : filter === "inbound" ? inbound : attention;
  const week7 = contacts.filter((c) => c.createdAt.slice(0, 10) >= addDays(v.today, -7)).length;

  return (
    <>
      <PageHeader
        title="Conversations"
        subtitle={`${week7} started in the last 7 days. Aim for 3 a day.`}
        action={
          <div className="flex gap-2">
            <Link href="/conversations/playbook" className="btn btn-ghost btn-sm">
              📖 DM playbook
            </Link>
            <Disclosure open={sp.new === "1"} summary={<span className="btn btn-primary btn-sm">+ New conversation</span>}>
              <form action={createContactAction} className="card grid gap-3 p-4 sm:grid-cols-2">
                <Field label="Name">
                  <input className="field" name="name" required placeholder="Priya Natarajan" autoFocus />
                </Field>
                <Field label="Platform">
                  <select className="field" name="platform" defaultValue="Facebook">
                    {CONTACT_PLATFORMS.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Profile link (optional)">
                  <input className="field" name="profileUrl" type="url" placeholder="https://…" />
                </Field>
                <Field label="Warmth">
                  <select className="field" name="warmth" defaultValue="warm">
                    <option value="cold">❄️ Cold — never spoken</option>
                    <option value="warm">🌤 Warm — knows me</option>
                    <option value="hot">🔥 Hot — asked about working together</option>
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="What are they building?">
                    <input className="field" name="whatTheyreBuilding" placeholder="Postpartum fitness program for new moms" />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <span className="label">First message (optional · +5 pts)</span>
                  <TemplatePicker templates={templates} values={{ Name: "" }} name="firstMessage" placeholder="Paste the first DM you sent…" />
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <button className="btn btn-primary" type="submit">
                    Save
                  </button>
                  <button className="btn btn-ghost" type="submit" name="open" value="1">
                    Save and open
                  </button>
                </div>
              </form>
            </Disclosure>
          </div>
        }
      />
      <p className="mb-4 text-sm text-ink-2" data-testid="clarity-link">
        Conversations is CLARITY in short form. The DM scripts run Recognition → Light Question → Stuck on X → Door Open: C → L → A → Y, with R, I and T left out — those are beats you can only do live.{" "}
        <Link href="/socrates/foundations" className="underline">Socrates Domain →</Link>
      </p>
      <Tabs items={tabs} current={filter === "inbound" ? "due" : filter} />
      <Card>
        {list.length ? (
          <div className="-mx-2 divide-y">
            {list.map((c) => (
              <ContactRow key={c.id} c={c} today={v.today} />
            ))}
          </div>
        ) : (
          <Empty
            icon="💬"
            title={filter === "due" ? "Nobody's waiting on you" : "Nothing here yet"}
            hint={filter === "due" ? "Inbox zero on DMs. Start 3 new conversations to keep the pipeline moving." : undefined}
            action={
              <Link href="/conversations?new=1" className="btn btn-ghost btn-sm">
                + New conversation
              </Link>
            }
          />
        )}
      </Card>
    </>
  );
}
