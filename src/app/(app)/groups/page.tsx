import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { createGroupAction, setGroupSlotAction } from "@/lib/actions/groups";
import { Badge, Card, Disclosure, Empty, Field, PageHeader, Progress } from "@/components/ui";
import { groupReadiness } from "@/lib/engine/groups";
import { formatDate } from "@/lib/dates";
import type { Group } from "@/db/schema";

export const metadata = { title: "Groups" };

function GroupRow({ g, slot }: { g: Group; slot?: string }) {
  const ready = groupReadiness(g);
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      {slot ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-white">{slot}</span> : null}
      <div className="min-w-0 flex-1">
        <Link href={`/groups/${g.id}`} className="block truncate font-medium hover:underline">
          {g.name}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          {g.adminName ? <span>Admin: {g.adminName}</span> : null}
          {g.memberCount ? <span>· {g.memberCount.toLocaleString()} members</span> : null}
          {g.rating ? <span>· {"⭐".repeat(g.rating)}</span> : null}
          {g.lastPostedAt ? <span>· posted {formatDate(g.lastPostedAt.slice(0, 10))}</span> : <span>· never posted</span>}
        </div>
      </div>
      <div className="w-28">
        <div className="mb-1 text-[10px] text-ink-3">Profile {ready}%</div>
        <Progress value={ready} tone={ready >= 75 ? "good" : ready >= 40 ? "accent" : "warn"} height={4} />
      </div>
      {g.kind !== "own" ? (
        <form action={setGroupSlotAction} className="flex items-center gap-1">
          <input type="hidden" name="id" value={g.id} />
          <select className="field w-auto py-1 text-xs" name="slot" defaultValue={g.kind === "prospect" && g.rank ? `prospect:${g.rank}` : g.kind === "prospect" ? "prospect:0" : "member:0"}>
            <option value="member:0">Member</option>
            <option value="prospect:1">Prospect #1</option>
            <option value="prospect:2">Prospect #2</option>
            <option value="prospect:3">Prospect #3</option>
            <option value="prospect:0">Prospect (bench)</option>
          </select>
          <button className="btn btn-ghost btn-xs" type="submit">Move</button>
        </form>
      ) : null}
    </li>
  );
}

export default async function GroupsPage() {
  const v = await requireViewer();
  const rows = await db.query.groups.findMany({ where: eq(schema.groups.userId, v.user.id), orderBy: [asc(schema.groups.kind), asc(schema.groups.rank), asc(schema.groups.name)] });
  const own = rows.filter((g) => g.kind === "own");
  const members = rows.filter((g) => g.kind === "member");
  const prospects = rows.filter((g) => g.kind === "prospect");
  const top3 = [1, 2, 3].map((r) => prospects.find((g) => g.rank === r) ?? null);
  const bench = prospects.filter((g) => !g.rank || g.rank > 3);
  return (
    <>
      <PageHeader title="Groups" subtitle="Your group, the groups you're in, and the three you're prospecting in this month. Every post gets shaped to the group it's going into." />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <Card title="🏠 My group" action={own.length ? <Badge tone="good">{own.length === 1 ? "set" : `${own.length} groups`}</Badge> : <Badge tone="warn">not set</Badge>}>
            {own.length ? <ul className="divide-y">{own.map((g) => <GroupRow key={g.id} g={g} />)}</ul> : <Empty icon="🏠" title="Add your own group" hint="Your Community Pass hashtag posts and CTAs go here first." />}
          </Card>
          <Card title="🎯 Top 3 to prospect in" action={<span className="text-xs text-ink-3">value first, never a pitch</span>}>
            <ul className="divide-y">
              {top3.map((g, i) => (g ? <GroupRow key={g.id} g={g} slot={String(i + 1)} /> : (
                <li key={`empty-${i}`} className="flex items-center gap-3 py-2.5 text-sm text-ink-3">
                  <span className="grid h-7 w-7 place-items-center rounded-full border text-xs font-bold">{i + 1}</span>
                  Open slot. Move a group here.
                </li>
              )))}
            </ul>
            {bench.length ? (
              <Disclosure summary={<span className="text-xs text-ink-3 underline">Bench ({bench.length})</span>} className="mt-2">
                <ul className="divide-y">{bench.map((g) => <GroupRow key={g.id} g={g} />)}</ul>
              </Disclosure>
            ) : null}
          </Card>
          <Card title="👥 Groups I'm a member of" action={<span className="text-xs text-ink-3">{members.length}</span>}>
            {members.length ? <ul className="divide-y">{members.map((g) => <GroupRow key={g.id} g={g} />)}</ul> : <p className="text-sm text-ink-2">Add the groups you already hang out in. When one starts working, promote it to a prospect slot.</p>}
          </Card>
        </div>
        <Card title="Add a group">
          <form action={createGroupAction} className="space-y-3">
            <Field label="Group name">
              <input className="field" name="name" required />
            </Field>
            <Field label="URL">
              <input className="field" name="url" type="url" placeholder="https://www.facebook.com/groups/…" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Which list">
                <select className="field" name="kind" defaultValue="member">
                  <option value="own">My group</option>
                  <option value="member">I&apos;m a member</option>
                  <option value="prospect">Prospect</option>
                </select>
              </Field>
              <Field label="Prospect slot (1–3)">
                <input className="field" name="rank" type="number" min={0} max={3} defaultValue={0} />
              </Field>
            </div>
            <Field label="Mission (from the About section)">
              <textarea className="field" name="mission" placeholder="Paste the group's description. The opener of every post references it." />
            </Field>
            <Field label="Admin name">
              <input className="field" name="adminName" />
            </Field>
            <Field label="What the admin values" hint="What they praise, what they delete, what they post themselves.">
              <textarea className="field" name="adminValues" />
            </Field>
            <Field label="Rules (paste them)">
              <textarea className="field" name="rules" placeholder="No links. No promo. Value first…" />
            </Field>
            <button className="btn btn-primary" type="submit">Add group</button>
          </form>
        </Card>
      </div>
    </>
  );
}
