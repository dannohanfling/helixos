import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { plannerAudit } from "@/lib/queries/planner-audit";
import { VERDICT_LABEL, type Verdict } from "@/lib/engine/planner-audit";
import { CHANNEL_SPECS } from "@/lib/engine/repurpose";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Planner audit" };

const TONE: Record<Verdict, "danger" | "warn" | "neutral" | "good" | "accent"> = { duplicate: "danger", orphan: "warn", published: "neutral", gone: "good", unknown: "accent" };

export default async function PlannerAuditPage() {
  const v = await requireCoach();
  const { clients, unconnected } = await plannerAudit(v.workspace.id);
  const total = (k: Verdict) => clients.reduce((n, c) => n + c.rows.filter((r) => r.verdict === k).length, 0);
  const label = (channel: string | null) => (channel ? (CHANNEL_SPECS.find((c) => c.key === channel)?.label ?? channel) : "");
  return (
    <>
      <PageHeader
        title="Planner audit"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/integrations" className="hover:underline">← Integrations</Link>
            <span>Posts in each client&apos;s Social Planner that HelixOS created and no longer tracks. Read-only: nothing on this page changes or deletes anything, here or in GoHighLevel.</span>
          </span>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm" data-testid="planner-audit-totals">
        <Badge tone="danger">{total("duplicate")} duplicate</Badge>
        <Badge tone="warn">{total("orphan")} untracked, different</Badge>
        <Badge tone="neutral">{total("published")} already published</Badge>
        <Badge tone="good">{total("gone")} gone</Badge>
        <Badge tone="accent">{total("unknown")} could not tell</Badge>
      </div>
      <p className="mb-4 text-xs text-ink-3">
        Two sources: HelixOS&apos;s own sync log, which holds every planner post id it ever created unless the log was cleared, and the planner&apos;s scheduled list, read live. A post is a <strong>duplicate</strong> only when it is still scheduled and a post HelixOS tracks for the same account carries the same text. Everything less certain is named as such. Remove a duplicate in GoHighLevel&apos;s Social Planner by its id; a wrong delete removes a real scheduled post, so read it there first.
      </p>
      {clients.length === 0 ? <Card title="No connected clients">No client has a GoHighLevel connection yet, so there is no planner to audit.</Card> : null}
      <div className="space-y-4" data-testid="planner-audit">
        {clients.map((c) => (
          <Card key={c.userId} title={c.userName} action={<span className="text-xs text-ink-3">{c.locationId} · {c.trackedCount} tracked · {c.loggedCount} logged · {c.plannerListed === null ? "planner list unavailable" : `${c.plannerListed} scheduled in the planner`}</span>}>
            {c.plannerError ? <p className="mb-2 rounded-lg bg-warn-soft p-2 text-xs">The planner&apos;s list could not be read ({c.plannerError}). Below is what the sync log knows, each id checked one by one.</p> : null}
            {c.rows.length === 0 ? (
              <p className="text-sm text-ink-2">Nothing untracked. Every planner post HelixOS knows of belongs to a post it still tracks.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-ink-3">
                    <tr>
                      <th className="py-1 pr-3">Verdict</th>
                      <th className="py-1 pr-3">Planner post id</th>
                      <th className="py-1 pr-3">Account</th>
                      <th className="py-1 pr-3">Scheduled for</th>
                      <th className="py-1 pr-3">Twin in HelixOS</th>
                      <th className="py-1 pr-3">Seen in</th>
                      <th className="py-1">Why</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y align-top">
                    {c.rows.map((r) => (
                      <tr key={r.ghlPostId} data-testid="audit-row" data-verdict={r.verdict} data-post-id={r.ghlPostId}>
                        <td className="py-1.5 pr-3"><Badge tone={TONE[r.verdict]}>{VERDICT_LABEL[r.verdict]}</Badge></td>
                        <td className="py-1.5 pr-3 font-mono">{r.ghlPostId}</td>
                        <td className="py-1.5 pr-3">{c.accountName(r.accountId ?? r.live?.accountIds[0] ?? null)}{r.channel ? <span className="text-ink-3"> · {label(r.channel)}</span> : null}</td>
                        <td className="py-1.5 pr-3">{r.live?.scheduleDate ? formatDateTime(r.live.scheduleDate, v.workspace.timezone) : "—"}</td>
                        <td className="py-1.5 pr-3">{r.twin ? <>{r.twin.itemTitle} <span className="font-mono text-ink-3">{r.twin.externalId}</span>{r.twin.sameText ? " · same text" : " · different text"}{r.twin.sameTime ? " · same time" : ""}</> : "—"}</td>
                        <td className="py-1.5 pr-3">{r.seenIn.join(" + ")}{r.loggedAt ? <span className="block text-ink-3">logged {formatDateTime(r.loggedAt, v.workspace.timezone)}</span> : null}</td>
                        <td className="py-1.5">{r.why}{r.live?.summary ? <span className="mt-1 block max-w-md truncate text-ink-3" title={r.live.summary}>“{r.live.summary}”</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {c.capped ? <p className="mt-2 text-xs text-ink-3">More than 40 untracked ids; only the first 40 are checked here.</p> : null}
              </div>
            )}
          </Card>
        ))}
      </div>
      {unconnected.length ? <p className="mt-4 text-xs text-ink-3">Not connected to GoHighLevel, so nothing to audit: {unconnected.join(", ")}.</p> : null}
    </>
  );
}
