import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { deleteContentAction } from "@/lib/actions/content";
import { saveContentToLibraryAction } from "@/lib/actions/library";
import { ContentForm } from "@/components/content-form";
import { CopyButton } from "@/components/copy-button";
import { Card, PageHeader } from "@/components/ui";

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, v.user.id)) });
  if (!item) notFound();
  const fullText = [item.hook, item.body].filter(Boolean).join("\n\n");
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
              <button className="btn btn-ghost btn-sm" type="submit">
                Delete
              </button>
            </form>
          </div>
        }
      />
      <Card>
        <ContentForm item={item} today={v.today} />
      </Card>
    </>
  );
}
