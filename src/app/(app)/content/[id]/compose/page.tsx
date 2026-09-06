import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { composerContext } from "@/lib/queries/compose";
import { Composer } from "@/components/composer";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Edit post" };

export default async function EditComposePage({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, v.user.id)) });
  if (!item) notFound();
  const [c, variants] = await Promise.all([composerContext(v), db.query.contentVariants.findMany({ where: eq(schema.contentVariants.contentItemId, id) })]);
  const overrides: Record<string, { body: string; subject?: string }> = {};
  const selected: string[] = [];
  for (const x of variants) {
    const key = x.groupId ? `grp:${x.groupId}` : `ch:${x.channel}`;
    selected.push(key);
    overrides[key] = { body: x.body, subject: x.subject ?? undefined };
  }
  return (
    <>
      <PageHeader title={`Redistribute: ${item.title}`} subtitle={<Link href={`/content/${item.id}`} className="hover:underline">← Back to the post</Link>} />
      <Composer {...c} initial={{ id: item.id, title: item.title, hook: item.hook ?? "", body: item.body ?? "", hasCta: item.hasCta, mediaUrl: item.mediaUrl ?? "", contentType: item.contentType, overrides, selected }} />
    </>
  );
}
