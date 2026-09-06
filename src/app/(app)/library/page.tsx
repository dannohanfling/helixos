import Link from "next/link";
import { CONTENT_TYPES } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { createLibraryPostAction, useLibraryPostAction } from "@/lib/actions/library";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Disclosure, Empty, Field, PageHeader, Tabs } from "@/components/ui";
import { matches, visibleLibrary } from "@/lib/queries/library-posts";
import type { LibraryPost } from "@/db/schema";

export const metadata = { title: "Library" };

const KIND_META = {
  post: { label: "Posts", icon: "✍️", blurb: "Proven posts and templates. Use one as-is or as a skeleton." },
  pattern: { label: "Patterns", icon: "🧩", blurb: "Fill-in-the-blank structures with a worked example." },
  hook: { label: "Hooks", icon: "🪝", blurb: "First lines that stop the scroll. Drop one into any post." },
  cta: { label: "CTAs", icon: "🎯", blurb: "Closing lines that get a reply, a click, or a DM." },
  mine: { label: "Mine", icon: "⭐", blurb: "Posts you saved from your own content, with the numbers they earned." },
} as const;
type Tab = keyof typeof KIND_META;

function sourceOf(p: LibraryPost, userId: string): { label: string; tone: "neutral" | "accent" | "good" } {
  if (p.userId === userId) return { label: "mine", tone: "good" };
  if (p.source === "coach") return { label: "from your coach", tone: "accent" };
  return { label: "Evolve Omega", tone: "neutral" };
}

function Entry({ p, userId }: { p: LibraryPost; userId: string }) {
  const src = sourceOf(p, userId);
  const text = p.kind === "hook" ? (p.hook ?? p.body) : p.kind === "cta" ? (p.cta ?? p.body) : [p.hook, p.body].filter(Boolean).join("\n\n");
  const short = p.kind === "hook" || p.kind === "cta";
  return (
    <div className={`card flex flex-col p-4 ${short ? "" : "min-h-56"}`}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/library/${p.id}`} className="font-semibold leading-snug hover:underline">
          {p.title}
        </Link>
        <Badge tone={src.tone}>{src.label}</Badge>
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ink-3">
        {p.contentType ? <span>{p.contentType}</span> : null}
        {p.pillar ? <span>· {p.pillar}</span> : null}
        {p.angle ? <span>· {p.angle}</span> : null}
        {p.engagements ? <span>· 👍 {p.engagements}</span> : null}
        {p.leads ? <span>· 🆕 {p.leads}</span> : null}
        {p.usedCount ? <span>· used {p.usedCount}×</span> : null}
      </div>
      <p className={`mt-2 whitespace-pre-line text-sm text-ink-2 ${short ? "" : "line-clamp-6"}`}>{text}</p>
      {p.useWhen ? <p className="mt-2 text-xs text-ink-3">Use when: {p.useWhen}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <form action={useLibraryPostAction}>
          <input type="hidden" name="id" value={p.id} />
          <button className="btn btn-accent btn-xs" type="submit">
            {short ? "Start a post with it" : "Use this"}
          </button>
        </form>
        <CopyButton text={text} label="Copy" className="btn btn-ghost btn-xs" />
        <Link href={`/library/${p.id}`} className="ml-auto text-xs text-ink-3 underline">
          Open
        </Link>
      </div>
    </div>
  );
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; type?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const all = await visibleLibrary(v.workspace.id, v.user.id);
  const tab: Tab = (Object.keys(KIND_META) as Tab[]).find((k) => k === sp.tab) ?? "post";
  const q = (sp.q ?? "").trim();
  const type = sp.type ?? "";
  const counts: Record<Tab, number> = { post: 0, pattern: 0, hook: 0, cta: 0, mine: 0 };
  for (const p of all) {
    if (p.userId === v.user.id) counts.mine++;
    else counts[p.kind]++;
  }
  const rows = all.filter((p) => (tab === "mine" ? p.userId === v.user.id : p.kind === tab && p.userId !== v.user.id)).filter((p) => matches(p, q)).filter((p) => !type || p.contentType === type);
  const meta = KIND_META[tab];
  const isCoach = v.role === "coach";
  return (
    <>
      <PageHeader title="Library" subtitle="Swipe files, hooks and CTAs that already work. Pick one, make it yours, post it." action={<Link href="/content/compose" className="btn btn-primary btn-sm">✍️ New post</Link>} />
      <Tabs items={(Object.keys(KIND_META) as Tab[]).map((k) => ({ key: k, label: `${KIND_META[k].icon} ${KIND_META[k].label}`, href: `/library?tab=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`, count: counts[k] }))} current={tab} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form className="flex flex-wrap items-center gap-2" method="get">
          <input type="hidden" name="tab" value={tab} />
          <input className="field w-64 py-1.5 text-sm" name="q" defaultValue={q} placeholder="Search words, pillars, tags…" />
          {tab === "post" || tab === "mine" ? (
            <select className="field w-auto py-1.5 text-sm" name="type" defaultValue={type}>
              <option value="">All types</option>
              {CONTENT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          ) : null}
          <button className="btn btn-ghost btn-sm" type="submit">
            Filter
          </button>
        </form>
        <span className="text-xs text-ink-3">{meta.blurb}</span>
      </div>

      {rows.length ? (
        <div className={`mt-4 grid gap-3 ${tab === "hook" || tab === "cta" ? "sm:grid-cols-2 xl:grid-cols-3" : "lg:grid-cols-2 xl:grid-cols-3"}`}>
          {rows.map((p) => (
            <Entry key={p.id} p={p} userId={v.user.id} />
          ))}
        </div>
      ) : (
        <Card className="mt-4">
          <Empty icon={meta.icon} title={q ? "Nothing matches" : tab === "mine" ? "Nothing saved yet" : "Nothing here yet"} hint={tab === "mine" ? "Open any of your posts and hit Save to library. Your best ones become templates." : "Try fewer words, or add your own below."} />
        </Card>
      )}

      <Card className="mt-6" title={isCoach ? "Add to the library" : "Add your own"}>
        <Disclosure summary={<span className="btn btn-soft btn-sm">+ New {tab === "mine" ? "post" : KIND_META[tab].label.toLowerCase().replace(/s$/, "")}</span>}>
          <form action={createLibraryPostAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="kind" value={tab === "mine" ? "post" : tab} />
            <Field label="Title">
              <input className="field" name="title" placeholder="What to call it" />
            </Field>
            <Field label="Type">
              <select className="field" name="contentType" defaultValue="">
                <option value="">Any</option>
                {CONTENT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            {tab !== "cta" ? (
              <div className="sm:col-span-2">
                <Field label={tab === "hook" ? "The hook" : "Hook (first line)"}>
                  <input className="field" name="hook" />
                </Field>
              </div>
            ) : null}
            {tab !== "hook" ? (
              <div className="sm:col-span-2">
                <Field label={tab === "cta" ? "The CTA" : "Body"}>
                  <textarea className="field min-h-32" name={tab === "cta" ? "cta" : "body"} />
                </Field>
              </div>
            ) : null}
            {tab === "post" || tab === "pattern" || tab === "mine" ? (
              <>
                <Field label="Use when">
                  <input className="field" name="useWhen" />
                </Field>
                <Field label="Why it works">
                  <input className="field" name="whyItWorks" />
                </Field>
              </>
            ) : null}
            <Field label="Pillar">
              <input className="field" name="pillar" placeholder="Systems, Community, Conversion…" />
            </Field>
            <Field label="Tags (comma separated)">
              <input className="field" name="tags" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="hasCta" /> Has a call to action
            </label>
            {isCoach ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="shared" defaultChecked /> Share with every member
              </label>
            ) : null}
            <div className="sm:col-span-2">
              <button className="btn btn-primary btn-sm" type="submit">
                Save to library
              </button>
            </div>
          </form>
        </Disclosure>
      </Card>
    </>
  );
}
