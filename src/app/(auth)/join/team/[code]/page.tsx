import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { hashSecret } from "@/lib/crypto";
import { inviteState } from "@/lib/engine/team";
import { TeamJoinForm } from "../team-join-form";

// A live one-time link; never indexed.
export const metadata = { title: "Join a team", robots: { index: false, follow: false } };

/**
 * Team access (Danno, 6 Oct): the page an invite link opens. Says whose team it is while the link is open; once used, cancelled
 * or a week old it says so and names nobody. The code is matched by its hash and never stored.
 */
export default async function JoinTeamPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const invite = await db.query.teamInvites.findFirst({ where: eq(schema.teamInvites.codeHash, hashSecret(code)) });
  const open = invite && inviteState(invite) === "open";
  const owner = open ? await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, invite.ownerMembershipId), eq(schema.memberships.workspaceId, invite.workspaceId)) }) : null;
  const ownerUser = owner && !owner.removedAt ? await db.query.users.findFirst({ where: eq(schema.users.id, owner.userId) }) : null;
  if (!ownerUser) {
    return (
      <div className="card p-6" data-testid="team-join-gone">
        <h1 className="text-xl font-bold">This invite link isn&apos;t open</h1>
        <p className="mb-4 mt-1 text-sm text-ink-2">It has expired, was cancelled, or was already used. Ask the person who invited you for a new one.</p>
        <p className="text-center text-sm text-ink-2">
          Already have a login?{" "}
          <Link href="/login" className="font-semibold text-ink underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }
  const business = owner!.businessName?.trim();
  return (
    <div className="card p-6" data-testid="team-join">
      <h1 className="text-xl font-bold">Join {ownerUser.name}&apos;s team</h1>
      <p className="mb-4 mt-1 text-sm text-ink-2">
        {ownerUser.name.split(" ")[0]} has invited you to work in their HelixOS{business ? ` for ${business}` : ""}: their content, DMs, tasks, webinars and contacts. Make your own login below.
      </p>
      <TeamJoinForm code={code} />
    </div>
  );
}
