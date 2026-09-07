import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { aiStatus } from "@/lib/ai";
import { Badge, PageHeader } from "@/components/ui";
import { TOOLS, toolName, toolStatus, type ToolFacts } from "@/lib/engine/tools";
import naming from "@/data/tools.json";

export const metadata = { title: "Tools" };

/** What the app can generate, each with what it makes, what it needs first, and the way in. A front door, not a runtime. */
export default async function ToolsPage() {
  const v = await requireViewer();
  const ws = v.workspace.id;
  const uid = v.user.id;
  const [ai, profile, proofs, webinars, latestContent, groups, principles] = await Promise.all([
    aiStatus(v),
    db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, ws), eq(schema.ladderProfiles.userId, uid)) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, ws), eq(schema.proofs.userId, uid), eq(schema.proofs.status, "approved")), limit: 1 }),
    db.query.webinars.findMany({ where: and(eq(schema.webinars.workspaceId, ws), eq(schema.webinars.userId, uid)), limit: 1 }),
    db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.workspaceId, ws), eq(schema.contentItems.userId, uid)), orderBy: desc(schema.contentItems.createdAt) }),
    db.query.groups.findMany({ where: and(eq(schema.groups.workspaceId, ws), eq(schema.groups.userId, uid)), limit: 1 }),
    db.query.principles.findMany({ limit: 1 }),
  ]);
  const facts: ToolFacts = {
    ai_key: ai.hasKey && !ai.blocked,
    ladder_facts: Boolean(profile?.productName),
    proof: proofs.length > 0,
    brand_voice: Boolean(v.workspace.brandVoice),
    webinar: webinars.length > 0,
    content: Boolean(latestContent),
    groups: groups.length > 0,
    principles: principles.length > 0,
  };
  const keyNote = ai.hasKey && ai.blocked ? `Paused for today: ${ai.callsToday} of ${ai.cap} calls used. Back tomorrow, or ask your coach.` : ai.lastError ? "Your key stopped working. Check it in Settings." : null;
  // Pre-fill where we can: the repurpose tools open on the latest piece of content
  const openFor = (feature: string, open: string) => (latestContent && (feature === "repurpose" || feature === "group_variant") ? `/content/${latestContent.id}/repurpose` : open);

  return (
    <>
      <PageHeader title="Tools" subtitle="What the app writes for you, on your own AI key. Each one says what it needs before you click." action={!facts.ai_key ? <Link href="/settings#ai" className="btn btn-accent btn-sm">Connect your AI key</Link> : null} />
      {keyNote ? <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm">{keyNote}</p> : null}
      <div className="grid gap-4 md:grid-cols-2" data-testid="tools">
        {TOOLS.map((tool) => {
          const { name, promise, named } = toolName(tool.feature, naming);
          const status = toolStatus(tool, facts);
          const open = openFor(tool.feature, tool.open);
          return (
            <section key={tool.feature} className="card flex flex-col p-5" data-testid="tool-card" data-feature={tool.feature} data-ready={status.ready ? "1" : "0"}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">
                    <span className="mr-1.5">{tool.icon}</span>
                    {name}
                  </h2>
                  {!named ? <div className="text-[11px] text-ink-3">working name</div> : null}
                </div>
                <Badge tone={status.ready ? "good" : "neutral"}>{status.ready ? "Ready" : `Needs ${status.missing.length} thing${status.missing.length === 1 ? "" : "s"}`}</Badge>
              </div>
              {promise ? <p className="mt-2 text-sm">{promise}</p> : null}
              <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Makes</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-2">
                {tool.makes.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Needs first</div>
              <ul className="mt-1 space-y-1 text-sm" data-testid="tool-needs">
                {tool.needs.map((n) => {
                  const ok = facts[n.key];
                  return (
                    <li key={n.key} className={`flex items-start gap-2 ${ok ? "text-ink-2" : n.required ? "" : "text-ink-3"}`}>
                      <span className={ok ? "text-good" : n.required ? "text-warn" : "text-ink-3"}>{ok ? "✓" : n.required ? "!" : "○"}</span>
                      <span>
                        {n.label}
                        {!ok ? (
                          <>
                            {" "}
                            · <Link href={n.href} className="underline">{n.missing}</Link>
                          </>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex items-center gap-2 pt-1">
                {status.ready ? (
                  <Link href={open} className="btn btn-accent btn-sm" data-testid="tool-open">
                    {tool.openLabel} →
                  </Link>
                ) : (
                  <>
                    <Link href={status.missing[0].href} className="btn btn-soft btn-sm" data-testid="tool-fix">
                      {status.missing[0].key === "ai_key" ? "Connect your key" : "Set this up"} →
                    </Link>
                    <Link href={open} className="text-xs text-ink-3 underline">
                      See where it lives
                    </Link>
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
