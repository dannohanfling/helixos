import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { ConfirmDelete } from "@/components/confirm-delete";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { acceptContentAction, deleteContentAction, setContentStatusAction } from "@/lib/actions/content";
import { gateFor, isUnreviewed } from "@/lib/engine/provenance";
import { GateBlock, UnreviewedMark } from "@/components/provenance";
import { saveContentToLibraryAction } from "@/lib/actions/library";
import { ContentForm } from "@/components/content-form";
import { CopyButton } from "@/components/copy-button";
import { Card, PageHeader } from "@/components/ui";

export default async function ContentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ gate?: string; status?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, v.user.id)) });
  if (!item) notFound();
  const fullText = [item.hook, item.body, item.cta].filter(Boolean).join("\n\n");
  // The status gate: this post, when its AI draft has not been read. Shown only after a status change to scheduled or posted asked for it.
  const gate = gateFor([{ name: item.title, origin: item.origin }]);
  return (
    <>
      <PageHeader
        title={item.title}
        subtitle={
          <Link href="/content" className="hover:underline">
            ← Back to content
          </Link>
        }
        action={
          <div className="flex gap-2">
            <Link href={`/content/${item.id}/compose`} className="btn btn-accent btn-sm">
              ♻️ Redistribute
            </Link>
            <Link href={`/content/${item.id}/repurpose`} className="btn btn-soft btn-sm">
              Every version
            </Link>
            {fullText ? <CopyButton text={fullText} label="Copy post" /> : null}
            <form action={saveContentToLibraryAction}>
              <input type="hidden" name="contentItemId" value={item.id} />
              <button className="btn btn-ghost btn-sm" type="submit" title="Keep this post as a template in your library">🗂️ Save to library</button>
            </form>
            <form action={deleteContentAction}>
              <input type="hidden" name="id" value={item.id} />
              <ConfirmDelete what="this post" label="Delete" className="btn btn-ghost btn-sm" />
            </form>
          </div>
        }
      />
      {sp.gate === "status" && gate && (sp.status === "scheduled" || sp.status === "posted") ? (
        <div className="mb-4">
          <GateBlock gate={gate} reviewHref={`/content/${item.id}`} action={setContentStatusAction} fields={{ id: item.id, status: sp.status }} />
        </div>
      ) : null}
      <Card>
        {isUnreviewed(item.origin) ? <UnreviewedMark action={acceptContentAction} fields={{ id: item.id }} className="mb-3" /> : null}
        <ContentForm item={item} today={v.today} />
      </Card>
    </>
  );
}
