import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { changedSinceLastPush, lastPushedLine, stage1Preview } from "@/lib/community-loyalty";
import { YourBotPanel } from "@/components/your-bot";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Their bot" };

/**
 * The coach's view of any member's bot: the same "Your bot" panel the member sees on their own page, read live, with the same
 * checks, approvals and one Push. The coach can push for any client, as before; the client can push their own.
 */
export default async function BotPushPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ pushed?: string; changed?: string; failed?: string; note?: string; saved?: string }> }) {
  const v = await requireCoach();
  const { clientId } = await params;
  const sp = await searchParams;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, clientId), eq(schema.memberships.workspaceId, v.workspace.id)) });
  if (!m) notFound();
  const own = m.id === v.membership.id;
  const u = own ? v.user : await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  if (!u) notFound();
  const [preview, changed, line] = await Promise.all([stage1Preview(m), changedSinceLastPush(m), lastPushedLine(m, v.user.id, v.workspace.timezone)]);
  const whose = own ? "your bot" : `${u.name}'s bot`;
  return (
    <>
      <PageHeader title={own ? "Your bot" : `${u.name}'s bot`} subtitle="Read from the bot just now. Nothing is sent until the Push below." action={<Link href={own ? "/coach" : `/coach/${m.id}`} className="btn btn-ghost btn-sm">Back</Link>} />
      <YourBotPanel m={m} preview={preview} own={own} whose={whose} sp={sp} lastPushedLine={`${line}${changed ? " · changed since the last push" : ""}`} />
    </>
  );
}
