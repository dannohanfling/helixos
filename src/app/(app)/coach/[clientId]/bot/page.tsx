import Link from "next/link";
import { BotConnectionCard } from "@/components/bot-connection-card";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { changedSinceLastPush, lastPushedLine, stage1Preview } from "@/lib/community-loyalty";
import { YourBotPanel } from "@/components/your-bot";
import { PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { setMfClientAction } from "@/lib/actions/magic-funnel";
import { ItemGone } from "@/components/item-gone";

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
  if (!m) return <ItemGone what="This client" href="/coach" list="the Coach page" />;
  const own = m.id === v.membership.id;
  const u = own ? v.user : await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  if (!u) return <ItemGone what="This client" href="/coach" list="the Coach page" />;
  const [preview, changed, line] = await Promise.all([stage1Preview(m), changedSinceLastPush(m), lastPushedLine(m, v.user.id, v.workspace.timezone)]);
  const whose = own ? "your bot" : `${u.name}'s bot`;
  return (
    <>
      <PageHeader title={own ? "Your bot" : `${u.name}'s bot`} subtitle="Read from the bot just now. Nothing is sent until the Push below." action={<Link href={own ? "/coach" : `/coach/${m.id}`} className="btn btn-ghost btn-sm">Back</Link>} />
      <YourBotPanel m={m} preview={preview} own={own} whose={whose} sp={sp} lastPushedLine={`${line}${changed ? " · changed since the last push" : ""}`} />
      {own ? null : (
        <section id="magic-funnel" className="card mt-6 scroll-mt-20 p-4 sm:p-5" data-testid="mf-client">
          <h2 className="font-semibold">🪄 Magic funnel</h2>
          <p className="mt-1 text-sm text-ink-2">Off until you turn it on for {u.name}. On, their bot can send each prospect a registration page written for them.</p>
          <form action={setMfClientAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="membershipId" value={m.id} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" value="1" defaultChecked={m.mfEnabled} data-testid="mf-client-enabled" /> On for {u.name}
            </label>
            <label className="block text-sm">
              <span className="label">Pages a day, at most</span>
              <input className="field tabular w-28" name="dailyCap" type="number" min={0} max={5000} defaultValue={m.mfDailyCap} data-testid="mf-client-cap" />
            </label>
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Saving…" data-testid="mf-client-save">Save</SubmitButton>
          </form>
        </section>
      )}
      <div className="mt-6">
        <BotConnectionCard workspaceId={m.workspaceId} userId={m.userId} membershipId={m.id} tz={m.timezone ?? v.workspace.timezone} forClient={!own} />
      </div>
    </>
  );
}
