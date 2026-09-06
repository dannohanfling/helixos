import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { PROVIDERS } from "@/db/schema";
import { requireCoach } from "@/lib/auth";
import { broadcastPassAction, clearSyncLogAction, rotateInboundSecretAction, saveIntegrationAction, testIntegrationAction } from "@/lib/actions/integrations";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Disclosure, Field, PageHeader } from "@/components/ui";
import { PROVIDER_META } from "@/lib/integrations";
import { GhlConnect } from "@/components/ghl-connect";
import { readiness } from "@/lib/engine/ghl-map";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const v = await requireCoach();
  const [rows, events, members, conns] = await Promise.all([
    db.query.integrations.findMany({ where: eq(schema.integrations.workspaceId, v.workspace.id) }),
    db.query.syncEvents.findMany({ where: eq(schema.syncEvents.workspaceId, v.workspace.id), orderBy: desc(schema.syncEvents.createdAt), limit: 40 }),
    db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.role, "client")) }),
    db.query.socialConnections.findMany({ where: eq(schema.socialConnections.workspaceId, v.workspace.id) }),
  ]);
  const connOf = new Map(conns.map((c) => [c.userId, c]));
  const users = members.length ? await db.query.users.findMany({ where: inArray(schema.users.id, members.map((m) => m.userId)) }) : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const withPass = members.filter((m) => m.eoPassSerial).length;
  const installed = members.filter((m) => m.eoPassInstalledAt).length;
  return (
    <>
      <PageHeader title="Integrations" subtitle="Points, passes, contacts and messages flow out. Rewards and bookings flow back in. Everything is logged." />
      <div className="grid gap-4 lg:grid-cols-2">
        {PROVIDERS.map((p) => {
          const meta = PROVIDER_META[p];
          const row = rows.find((r) => r.provider === p);
          const hook = `${appUrl}/api/webhooks/${p === "community_loyalty" ? "community-loyalty" : "ghl"}`;
          return (
            <Card key={p} title={`${meta.icon} ${meta.name}`} action={row?.enabled ? <Badge tone="good">on</Badge> : <Badge tone="neutral">off</Badge>}>
              <p className="mb-3 text-sm text-ink-2">{meta.blurb}</p>
              <form action={saveIntegrationAction} className="space-y-3">
                <input type="hidden" name="provider" value={p} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="enabled" value="1" defaultChecked={row?.enabled ?? false} /> Enabled
                </label>
                {meta.fields.map((f) => (
                  <Field key={f.key} label={f.label} hint={f.secret && row?.config[f.key] ? "Saved. Leave blank to keep." : f.hint}>
                    <input className="field" name={f.key} type={f.secret ? "password" : "text"} defaultValue={f.secret ? "" : (row?.config[f.key] ?? "")} placeholder={f.secret && row?.config[f.key] ? "••••••••" : f.hint} autoComplete="off" />
                  </Field>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn btn-primary btn-sm" type="submit">Save</button>
                  {row?.lastSyncAt ? <span className="text-xs text-ink-3">Last sync {formatDateTime(row.lastSyncAt, v.workspace.timezone)}</span> : null}
                  {row?.lastError ? <span className="text-xs text-danger">Last error: {row.lastError}</span> : null}
                </div>
              </form>
              <div className="mt-2 flex flex-wrap gap-2">
                <form action={testIntegrationAction}>
                  <input type="hidden" name="provider" value={p} />
                  <button className="btn btn-ghost btn-xs" type="submit">Send test ping</button>
                </form>
                <form action={rotateInboundSecretAction}>
                  <input type="hidden" name="provider" value={p} />
                  <button className="btn btn-ghost btn-xs" type="submit">{row?.inboundSecret ? "Rotate inbound secret" : "Create inbound secret"}</button>
                </form>
              </div>
              <Disclosure summary={<span className="text-xs text-ink-3 underline">Inbound webhook</span>} className="mt-3">
                <div className="mt-2 space-y-2 text-xs">
                  <p className="text-ink-2">Point {meta.name.split(" (")[0]} at this URL. Send the secret as the <code>x-helix-secret</code> header or <code>?secret=</code>.</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1">{hook}</code>
                    <CopyButton text={hook} label="Copy" className="btn btn-ghost btn-xs" />
                  </div>
                  {row?.inboundSecret ? (
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1">{row.inboundSecret}</code>
                      <CopyButton text={row.inboundSecret} label="Copy" className="btn btn-ghost btn-xs" />
                    </div>
                  ) : null}
                  <p className="text-ink-3">{p === "community_loyalty" ? "Events: pass.installed (email or serial), points.earned (email, points, reason)." : "Events: contact.created, appointment.booked (email, full_name, startTime)."}</p>
                </div>
              </Disclosure>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4" title="🚀 Client sub-accounts (Social Planner)" action={<span className="text-xs text-ink-3">{conns.length}/{members.length} connected</span>}>
        <p className="mb-3 text-sm text-ink-2">Each client publishes through their own sub-account under your agency. Enter their location ID and GHL user ID here or let them do it on their Settings page. HelixOS mints a 24-hour location token from your agency token whenever it needs one.</p>
        <div className="divide-y">
          {members.map((m) => {
            const c = connOf.get(m.userId) ?? null;
            const r = c ? readiness(c.mapping) : null;
            return (
              <Disclosure
                key={m.id}
                summary={
                  <span className="flex items-center gap-3 py-1 text-sm">
                    <span className="w-40 truncate font-medium">{userName.get(m.userId) ?? m.userId}</span>
                    <Badge tone={c?.lastError ? "danger" : r && r.mapped ? "good" : c ? "accent" : "neutral"}>{c?.lastError ? "error" : r ? `${r.mapped}/${r.total} channels` : "not connected"}</Badge>
                    {c ? <span className="text-xs text-ink-3">{c.locationId}</span> : null}
                  </span>
                }
                className="py-1"
              >
                <div className="pb-3 pl-1">
                  <GhlConnect conn={c} forUserId={m.userId} tz={v.workspace.timezone} compact />
                </div>
              </Disclosure>
            );
          })}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card title="🎫 Evolve Omega passes" action={<span className="text-xs text-ink-3">{installed}/{withPass} installed · {members.length} members</span>}>
          <p className="mb-3 text-sm text-ink-2">Each member carries their own Evolve Omega pass. Points land on it, and you can message the whole cohort from here. Assign pass links per client on the Coach page.</p>
          <form action={broadcastPassAction} className="space-y-2">
            <Field label="Title">
              <input className="field" name="title" defaultValue="Evolve Omega" />
            </Field>
            <Field label="Message">
              <textarea className="field" name="body" required placeholder="Coaching call in 30 minutes. Bring one win and one stuck point." />
            </Field>
            <Field label="Send to">
              <select className="field" name="userId" defaultValue="">
                <option value="">Everyone with a pass</option>
                {members.map((m) => <option key={m.id} value={m.userId}>{userName.get(m.userId) ?? m.userId}</option>)}
              </select>
            </Field>
            <button className="btn btn-accent btn-sm" type="submit">Push to passes</button>
          </form>
        </Card>
        <Card title="Sync log" action={events.length ? <form action={clearSyncLogAction}><button className="text-xs text-ink-3 underline" type="submit">Clear</button></form> : null}>
          {events.length ? (
            <ul className="divide-y text-xs">
              {events.map((e) => (
                <li key={e.id} className="flex items-start gap-2 py-1.5">
                  <span className="w-5 text-center">{e.direction === "out" ? "↗" : "↙"}</span>
                  <Badge tone={e.status === "sent" || e.status === "received" ? "good" : e.status === "failed" ? "danger" : "neutral"}>{e.status}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{PROVIDER_META[e.provider as keyof typeof PROVIDER_META]?.icon ?? "•"} {e.event}</span>
                    {e.userId ? <span className="text-ink-3"> · {userName.get(e.userId) ?? "coach"}</span> : null}
                    {e.note ? <span className="block truncate text-ink-3">{e.note}</span> : null}
                  </span>
                  <span className="shrink-0 text-ink-3">{formatDateTime(e.createdAt.includes("T") ? e.createdAt : e.createdAt.replace(" ", "T") + "Z", v.workspace.timezone)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Nothing yet. Points, bookings and pushes show up here as they happen.</p>
          )}
        </Card>
      </div>
    </>
  );
}
