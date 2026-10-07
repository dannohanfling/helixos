import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { readSession } from "@/lib/session";
import { choicesFor } from "@/lib/team";
import { chooseMembershipAction, logoutAction } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Which HelixOS?" };

/**
 * Which HelixOS to be in (Danno, 6 Oct): shown after sign-in to a person with more than one (their own in two workspaces, or
 * their own and a team they're on), and from "Switch HelixOS" in the sidebar. Only their own live choices are listed; picking
 * one rewrites the session whole.
 */
export default async function ChoosePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await readSession();
  if (!session) redirect("/login");
  const choices = await choicesFor(session.userId);
  if (choices.length <= 1) redirect("/today");
  const { next } = await searchParams;
  const own = session.tm ? null : await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, session.userId), eq(schema.memberships.workspaceId, session.workspaceId)), columns: { id: true } });
  const current = session.tm ? `t:${session.tm}` : own ? `m:${own.id}` : null;
  return (
    <div className="card p-6" data-testid="choose">
      <h1 className="text-xl font-bold">Which HelixOS?</h1>
      <p className="mb-4 mt-1 text-sm text-ink-2">You&apos;re part of more than one. Pick the one to work in now; you can switch any time from the sidebar.</p>
      <ul className="space-y-2">
        {choices.map((c) => (
          <li key={c.key}>
            <form action={chooseMembershipAction}>
              <input type="hidden" name="choice" value={c.key} />
              {next ? <input type="hidden" name="next" value={next} /> : null}
              <SubmitButton className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm hover:bg-surface-2 ${c.key === current ? "border-accent" : "border-line"}`} pendingText="Opening…" data-testid="choose-option" data-kind={c.kind}>
                <span>
                  <span className="block font-semibold">{c.label}</span>
                  <span className="block text-xs text-ink-3">{c.sub}</span>
                </span>
                {c.key === current ? <span className="text-xs text-ink-3">you&apos;re here</span> : <span className="text-xs text-ink-3">open →</span>}
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
      <form action={logoutAction} className="mt-4 text-center">
        <SubmitButton className="text-xs text-ink-3 hover:text-ink" pendingText="Logging out…">
          Log out
        </SubmitButton>
      </form>
    </div>
  );
}
