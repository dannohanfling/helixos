import Link from "next/link";
import type { Viewer } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";

/**
 * Team access (Danno, 6 Oct): Settings to a team member. The owner's account, consent, keys, connections, data and team are
 * none of theirs, so none is shown, set or not set. What is here is their own sign-in and the way back.
 */
export function TeamSettings({ v }: { v: Viewer }) {
  const first = v.team!.ownerName.split(" ")[0];
  return (
    <>
      <PageHeader title="Settings" subtitle={`${first}'s account, connections and settings are their own. Nothing of theirs is here.`} />
      <Card title="You" className="mb-4">
        <ul className="space-y-1 text-sm" data-testid="team-settings">
          <li className="flex flex-wrap justify-between gap-2">
            <span>Signed in as</span>
            <span className="text-ink-2">
              {v.actor.name} · {v.actor.email}
            </span>
          </li>
          <li className="flex flex-wrap justify-between gap-2">
            <span>On the team of</span>
            <span className="text-ink-2">{v.team!.ownerName}</span>
          </li>
          <li className="flex flex-wrap justify-between gap-2">
            <span>Open to you</span>
            <span className="text-ink-2">Content, DMs, tasks, webinars and contacts</span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-ink-3">
          To change your password, log out and use{" "}
          <Link href="/forgot" className="underline">
            Forgot your password
          </Link>
          . To leave the team, ask {first} to remove you.
        </p>
      </Card>
    </>
  );
}
