import Link from "next/link";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { moveToClientAction } from "@/lib/actions/move";
import { MOVE_KIND_LABEL, PICKABLE, parsePicks, planKey, planMove } from "@/lib/engine/move";
import { moveWorldFor } from "@/lib/queries/move";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Move to a client" };

type Sp = { client?: string; pick?: string | string[]; moved?: string; to?: string; error?: string; changed?: string };
const list = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);

/**
 * Move to a client's workspace (handoff 27 Sep): the coach's own webinars, offers, proof, lead magnets, images and evidence, each
 * with a tick box. Pick the client, see what moves (with what each item carries, and what stays and why), then Move. Coach only;
 * reusable for every client migration, and nothing moves until the coach presses Move on the plan shown.
 */
export default async function MovePage({ searchParams }: { searchParams: Promise<Sp> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const [clients, world] = await Promise.all([
    db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) }),
    moveWorldFor(v.workspace.id, v.user.id),
  ]);
  const users = clients.length ? await db.query.users.findMany({ where: inArray(schema.users.id, clients.map((c) => c.userId)) }) : [];
  const nameOf = (m: schema.Membership) => users.find((u) => u.id === m.userId)?.name ?? "Client";
  const picked = parsePicks(list(sp.pick));
  const pickedKeys = new Set(picked.map((p) => `${p.kind}:${p.id}`));
  const client = clients.find((c) => c.id === sp.client) ?? null;
  const plan = client && picked.length ? planMove(world, picked) : null;
  const movedTo = clients.find((c) => c.id === sp.to);
  const botOffers = plan ? plan.moves.filter((m) => m.kind === "offer" && world.onBot.has(m.id)) : [];

  return (
    <>
      <PageHeader title="Move to a client" subtitle="Your own webinars, offers, proof, lead magnets, images and evidence, moved to one of your clients. Nothing moves until you press Move on the plan below." action={<Link href="/coach" className="btn btn-ghost btn-sm">Coach view</Link>} />
      {sp.moved && movedTo ? <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" role="status" data-testid="move-done">Moved {sp.moved} {sp.moved === "1" ? "item" : "items"} to {nameOf(movedTo)}. They now show on their pages, not yours.</p> : null}
      {sp.changed ? <p className="mb-4 rounded-xl border border-warn bg-warn-soft p-3 text-sm" role="alert" data-testid="move-changed">Something changed since the plan was shown, so nothing moved. Here is the plan as it is now.</p> : null}
      {sp.error ? <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="move-error">{sp.error === "client" ? "Pick one of your clients." : "Pick at least one item."}</p> : null}

      <form method="get" className="space-y-4" data-testid="move-pick">
        <Card title="1. The client">
          {clients.length ? (
            <select className="field" name="client" defaultValue={client?.id ?? ""} data-testid="move-client">
              <option value="">Pick a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {nameOf(c)}
                  {c.businessName ? ` · ${c.businessName}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-ink-2">You have no clients yet. Add one first.</p>
          )}
        </Card>
        <Card title="2. What moves">
          <div className="grid gap-4 md:grid-cols-2">
            {PICKABLE.map((kind) => {
              const rows = world.rows.filter((r) => r.kind === kind);
              return (
                <fieldset key={kind} data-testid={`move-kind-${kind}`}>
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{MOVE_KIND_LABEL[kind]}s</legend>
                  {rows.length ? (
                    <ul className="space-y-1 text-sm">
                      {rows.map((r) => (
                        <li key={r.id}>
                          <label className="flex items-start gap-2">
                            <input type="checkbox" name="pick" value={`${kind}:${r.id}`} defaultChecked={pickedKeys.has(`${kind}:${r.id}`)} className="mt-1" data-testid="move-item" />
                            <span>
                              {r.label}
                              {kind === "offer" && world.onBot.has(r.id) ? <span className="text-xs text-warn"> · on your bot</span> : null}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-ink-3">None of yours.</p>
                  )}
                </fieldset>
              );
            })}
          </div>
          <button className="btn btn-soft btn-sm mt-4" type="submit" data-testid="move-preview">
            See what moves
          </button>
        </Card>
      </form>

      {plan && client ? (
        <Card className="mt-4" title={`3. The plan: to ${nameOf(client)}`} action={<Badge tone="accent">{plan.moves.length} {plan.moves.length === 1 ? "item" : "items"}</Badge>}>
          <div data-testid="move-plan">
            <ul className="space-y-1 text-sm">
              {plan.moves.map((m) => (
                <li key={`${m.kind}:${m.id}`} data-testid="move-row" data-kind={m.kind} data-why={m.why === "picked" ? "picked" : "carried"}>
                  <b>{MOVE_KIND_LABEL[m.kind]}</b> {m.label}
                  {m.why === "picked" ? null : <span className="text-xs text-ink-3"> · carried: the {m.why}</span>}
                </li>
              ))}
            </ul>
            {plan.cannot.length || plan.warnings.length || botOffers.length ? (
              <div className="mt-3 space-y-1">
                {botOffers.map((o) => <p key={o.id} className="rounded bg-warn-soft p-2 text-sm" data-testid="move-warning">Offer &ldquo;{o.label}&rdquo; is on your bot. After the move your bot no longer sells it, from your next push.</p>)}
                {plan.warnings.map((w) => <p key={w} className="rounded bg-warn-soft p-2 text-sm" data-testid="move-warning">{w}</p>)}
                {plan.cannot.map((w) => <p key={w} className="rounded bg-surface-2 p-2 text-sm" data-testid="move-cannot">{w}</p>)}
              </div>
            ) : null}
            <p className="mt-3 text-xs text-ink-3">Each item keeps everything but its owner: its sections, components and attachments go with it, and a proof keeps its permission record. {nameOf(client)} sees them on their own pages; you still see them from their page on Coach.</p>
            <form action={moveToClientAction} className="mt-3">
              <input type="hidden" name="clientId" value={client.id} />
              <input type="hidden" name="key" value={planKey(client.id, plan)} />
              {picked.map((p) => <input key={`${p.kind}:${p.id}`} type="hidden" name="pick" value={`${p.kind}:${p.id}`} />)}
              <SubmitButton className="btn btn-primary btn-sm" pendingText="Moving…" data-testid="move-go">
                Move {plan.moves.length} {plan.moves.length === 1 ? "item" : "items"} to {nameOf(client)}
              </SubmitButton>
            </form>
          </div>
        </Card>
      ) : null}
    </>
  );
}
