import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { canReadForum } from "@/lib/forum";
import { HandoffInboxView } from "@/components/handoff-inbox-view";
import { ownerFirst } from "@/lib/engine/handoff";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Agent inbox" };

/**
 * The Agent inbox (H-727): a member's own Handoff inbox, beside The Forum. Their agents' briefs and plans land here, and only
 * their own tap approves anything. Private like the Forum: a coach switched into the member sees that it is private, and a
 * coach the member shares their Forum with ("Share with my coach") reads it at ?member=, read only, with no buttons at all;
 * the actions refuse it anyway, since they act only on the signed-in member's own inbox. A team member gets not found
 * (requireViewer). The coach's own inbox is Coach → Inbox.
 */
export default async function AgentInboxPage({ searchParams }: { searchParams: Promise<{ member?: string; tab?: string; q?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  if (v.switchedInto) return <Private line={`This inbox is private to ${ownerFirst(v.switchedInto.clientName)}.`} />;
  const ownerId = sp.member && sp.member !== v.user.id ? sp.member : v.user.id;
  const own = ownerId === v.user.id;
  if (own && v.role === "coach") redirect(sp.tab ? `/coach/inbox?tab=${encodeURIComponent(sp.tab)}` : "/coach/inbox");
  if (!own && !(await canReadForum(v, ownerId))) return <Private line="This inbox is private. A member's agent inbox shows here only while they share their Forum with you." />;
  const owner = own ? v.user : await db.query.users.findFirst({ where: eq(schema.users.id, ownerId), columns: { name: true } });
  const member = own ? undefined : ownerId;
  return (
    <HandoffInboxView
      o={{ workspaceId: v.workspace.id, userId: ownerId }}
      ownerFirst={ownerFirst(owner?.name)}
      tz={v.tz}
      tab={sp.tab}
      q={sp.q}
      base={member ? `/forum/inbox?member=${encodeURIComponent(member)}` : "/forum/inbox"}
      member={member}
      forumHref={member ? `/forum?member=${encodeURIComponent(member)}` : "/forum"}
      coach={false}
      readOnly={!own}
    />
  );
}

function Private({ line }: { line: string }) {
  return (
    <>
      <PageHeader title="Agent inbox" />
      <Card>
        <p className="text-sm text-ink-2" data-testid="agent-inbox-private">
          {line}
        </p>
      </Card>
    </>
  );
}
