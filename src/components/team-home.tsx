import Link from "next/link";
import type { Viewer } from "@/lib/auth";
import { NewTaskForm } from "@/components/new-task-form";
import { Card, PageHeader } from "@/components/ui";

const DOORS: { href: string; label: string; icon: string; line: string }[] = [
  { href: "/tasks", label: "Tasks", icon: "✅", line: "What's on the plate, and what you add to it" },
  { href: "/content", label: "Content", icon: "✍️", line: "Posts, the composer, ladders, the library" },
  { href: "/conversations", label: "DMs", icon: "💬", line: "Conversations and the playbook" },
  { href: "/webinars", label: "Webinars", icon: "🎤", line: "The wizard, scripts and the deck" },
  { href: "/clients", label: "Contacts", icon: "🤝", line: "Their clients and check-ins" },
];

/**
 * Team access (Danno, 6 Oct): what Today is to a team member. The owner's own day (lock-in, close, streak, goal, Body) is not
 * theirs to see or do, so Today shows the five doors open to them and the quick task form instead.
 */
export function TeamHome({ v }: { v: Viewer }) {
  const first = v.team!.ownerName.split(" ")[0];
  return (
    <>
      <PageHeader title={`${first}'s HelixOS`} subtitle={`You're on ${v.team!.ownerName}'s team as ${v.actor.name}. ${first} sees every change you make as yours.`} />
      <div className="grid gap-3 sm:grid-cols-2" data-testid="team-home">
        {DOORS.map((d) => (
          <Link key={d.href} href={d.href} className="card flex items-start gap-3 p-4 hover:bg-surface-2">
            <span className="text-2xl">{d.icon}</span>
            <span>
              <span className="block font-semibold">{d.label}</span>
              <span className="block text-sm text-ink-3">{d.line}</span>
            </span>
          </Link>
        ))}
      </div>
      <Card className="mt-4" title="Add a task for them">
        <NewTaskForm today={v.today} />
      </Card>
    </>
  );
}
