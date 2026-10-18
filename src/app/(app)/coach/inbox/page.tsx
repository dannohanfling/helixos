import { requireCoach } from "@/lib/auth";
import { HandoffInboxView } from "@/components/handoff-inbox-view";
import { ownerFirst } from "@/lib/engine/handoff";

export const metadata = { title: "Inbox" };

/**
 * Coach → Inbox (rev 769): the Handoff inbox, the coach's own. The page is the shared inbox view (H-727) with the coach's own
 * parts on: the Agents link, check-ins and the email switches. A member's own is the Agent inbox at /forum/inbox.
 */
export default async function CoachInboxPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const coach = await requireCoach();
  const sp = await searchParams;
  return (
    <HandoffInboxView
      o={{ workspaceId: coach.workspace.id, userId: coach.user.id }}
      ownerFirst={ownerFirst(coach.user.name)}
      tz={coach.tz}
      tab={sp.tab}
      q={sp.q}
      base="/coach/inbox"
      forumHref="/forum"
      coach
      readOnly={false}
    />
  );
}
