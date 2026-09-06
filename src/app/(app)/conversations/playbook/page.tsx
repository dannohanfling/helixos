import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, PageHeader } from "@/components/ui";
import { templatesFor } from "@/lib/queries/templates";
import { db, schema } from "@/db";
import { eq, isNull, or } from "drizzle-orm";

export const metadata = { title: "DM Playbook" };

export default async function PlaybookPage() {
  const v = await requireViewer();
  const lite = await templatesFor(v.workspace.id);
  const full = await db.query.dmTemplates.findMany({ where: or(isNull(schema.dmTemplates.workspaceId), eq(schema.dmTemplates.workspaceId, v.workspace.id)) });
  const byId = new Map(full.map((f) => [f.id, f]));
  const sequences = new Map<string, typeof lite>();
  for (const t of lite) sequences.set(t.sequence, [...(sequences.get(t.sequence) ?? []), t]);
  return (
    <>
      <PageHeader
        title="DM Playbook"
        subtitle={
          <>
            <Link href="/conversations" className="hover:underline">
              ← Conversations
            </Link>
            {" · "}Recognition first. Then a question. Then the door.
          </>
        }
      />
      <div className="space-y-4">
        {[...sequences.entries()].map(([seq, list]) => (
          <Card key={seq} title={seq}>
            <ol className="space-y-3">
              {list.map((t) => {
                const f = byId.get(t.id);
                return (
                  <li key={t.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        <span className="badge">Step {t.step}</span>
                        {t.branch ? <Badge tone="accent">{t.branch}</Badge> : null}
                        {f?.purpose ? <span className="text-xs font-normal text-ink-3">{f.purpose}</span> : null}
                      </div>
                      <CopyButton text={t.body} />
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm">{t.body}</p>
                    {t.whenToSend ? (
                      <p className="mt-2 text-xs text-ink-2">
                        <span className="font-semibold">When:</span> {t.whenToSend}
                      </p>
                    ) : null}
                    {f?.whyItWorks ? (
                      <p className="mt-1 text-xs text-ink-3">
                        <span className="font-semibold">Why it works:</span> {f.whyItWorks}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </Card>
        ))}
      </div>
    </>
  );
}
