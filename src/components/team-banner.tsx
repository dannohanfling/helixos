import { Suspense } from "react";
import Link from "next/link";
import type { Team } from "@/lib/auth";
import { SwitchErrorLine } from "@/components/switch-error-line";

/**
 * Team access (Danno, 6 Oct): on every page while a team member is in the owner's HelixOS, so it is never mistaken for their
 * own. Says whose it is and that the owner sees every change as theirs. A refused write shows its reason here too. With more
 * than one HelixOS to sign in to, the way to the other is here.
 */
export function TeamBanner({ team, choices }: { team: Team; choices: number }) {
  const first = team.ownerName.split(" ")[0];
  return (
    <div className="sticky top-0 z-40 border-b border-accent bg-accent-soft px-4 py-2 text-sm" role="region" aria-label="Working in a member's HelixOS" data-testid="team-banner">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">You&apos;re in {team.ownerName}&apos;s HelixOS as a team member.</span>
        <span className="text-xs text-ink-2">{first} sees every change as yours. Content, DMs, tasks, webinars and contacts are open to you.</span>
        {choices > 1 ? (
          <Link href="/choose" className="btn btn-primary btn-xs ml-auto" data-testid="team-switch">
            Switch HelixOS
          </Link>
        ) : null}
      </div>
      <Suspense fallback={null}>
        <SwitchErrorLine />
      </Suspense>
    </div>
  );
}
