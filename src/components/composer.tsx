"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CONTENT_TYPES } from "@/db/schema";
import { polishTargetsAction, saveComposeAction, type ComposeResult } from "@/lib/actions/compose";
import { channelTargets, draftFor, groupTargets, localIso, staggerSchedule, type Draft, type GroupTarget, type Target, type TargetKey } from "@/lib/engine/compose";
import { hashtagsFor } from "@/lib/engine/repurpose";
import { ChannelPreview, type Persona } from "./channel-previews";
import { AiStatus } from "@/components/ai-status";

type Initial = { id?: string; title?: string; hook?: string; body?: string; hasCta?: boolean; mediaUrl?: string; contentType?: string; overrides?: Record<string, { body: string; subject?: string }>; selected?: string[] };

const EMOJI = ["🔥", "✅", "👇", "💡", "🙌", "❤️", "👉", "⚡", "🎯", "😅", "🤝", "📌"];
const DEFAULT_SELECTED: TargetKey[] = ["ch:fb_personal", "ch:instagram", "ch:threads", "ch:linkedin"];

type Snippet = { id: string; title: string; text: string };

export function Composer({ groups, persona, hashtag, today, aiEnabled, socialConnected, initial, snippets }: { groups: GroupTarget[]; persona: Persona; hashtag: string | null; today: string; aiEnabled: boolean; socialConnected: boolean; initial?: Initial; snippets?: { hooks: Snippet[]; ctas: Snippet[] } }) {
  const router = useRouter();
  const targets = useMemo(() => [...groupTargets(groups), ...channelTargets()], [groups]);
  const byKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [hook, setHook] = useState(initial?.hook ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [hasCta, setHasCta] = useState(initial?.hasCta ?? true);
  const [mediaUrl, setMediaUrl] = useState(initial?.mediaUrl ?? "");
  const [contentType, setContentType] = useState(initial?.contentType ?? "CTA Post");
  const [selected, setSelected] = useState<TargetKey[]>(() => {
    const init = (initial?.selected ?? []).filter((k) => byKey.has(k as TargetKey)) as TargetKey[];
    if (init.length) return init;
    const own = groups.filter((g) => g.kind === "own").map((g) => `grp:${g.id}` as TargetKey);
    return [...own, ...DEFAULT_SELECTED];
  });
  const [customize, setCustomize] = useState(Boolean(initial?.overrides && Object.keys(initial.overrides).length));
  const [overrides, setOverrides] = useState<Record<string, { body: string; subject?: string }>>(initial?.overrides ?? {});
  const [tab, setTab] = useState<TargetKey | "all">("all");
  const [previewTab, setPreviewTab] = useState<TargetKey | "all">("all");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("09:00");
  const [stagger, setStagger] = useState(true);
  const [pending, start] = useTransition();
  const [polishing, setPolishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ComposeResult | null>(null);

  const src = useMemo(() => ({ title: title || hook.slice(0, 60), hook, body, hasCta, hashtag, firstName: persona.name.split(" ")[0] }), [title, hook, body, hasCta, hashtag, persona.name]);
  const chosen = selected.map((k) => byKey.get(k)).filter((t): t is Target => Boolean(t));
  const draftOf = (t: Target): Draft => {
    const auto = draftFor(src, t);
    const o = customize ? overrides[t.key] : undefined;
    return o ? { ...auto, body: o.body, subject: o.subject ?? auto.subject } : auto;
  };
  const schedule = useMemo(() => (stagger ? staggerSchedule(chosen, localIso(date, time)) : new Map(chosen.map((t) => [t.key, `${date}T${time}`]))), [chosen, stagger, date, time]);
  const problems = chosen.filter((t) => {
    const d = draftOf(t);
    return !d.body.trim() || d.body.length > t.maxChars;
  });
  const active = tab !== "all" ? byKey.get(tab) : undefined;
  const activeDraft = active ? draftOf(active) : null;

  const toggle = (k: TargetKey) => {
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
    if (tab === k) setTab("all");
    if (previewTab === k) setPreviewTab("all");
  };
  const insert = (text: string) => setBody((b) => (b ? `${b}${b.endsWith("\n") ? "" : "\n"}${text}` : text));
  const setOverride = (k: TargetKey, patch: { body?: string; subject?: string }) =>
    setOverrides((o) => {
      const cur = o[k] ?? { body: active ? draftFor(src, active).body : "", subject: active ? draftFor(src, active).subject : undefined };
      return { ...o, [k]: { ...cur, ...patch } };
    });

  const submit = (mode: "draft" | "schedule" | "now") =>
    start(async () => {
      setNotice(null);
      const payload = {
        id: initial?.id ?? null,
        title: src.title,
        hook,
        body,
        hasCta,
        mediaUrl,
        contentType,
        mode,
        targets: chosen.map((t) => {
          const d = draftOf(t);
          const at = schedule.get(t.key);
          return { key: t.key, channel: t.channel, groupId: t.groupId, body: d.body, subject: d.subject, postAt: mode === "schedule" && at ? `${at}:00` : null };
        }),
      };
      const r = await saveComposeAction(payload);
      setResult(r);
      if (mode === "draft") router.push(`/content/${r.id}/repurpose`);
      else setNotice(mode === "now" ? `Posted to ${r.posted} places. Groups are ready to paste; channels went to the Social Planner${socialConnected ? "" : " queue (connect GoHighLevel to auto-publish)"}.` : `Scheduled ${r.scheduled} posts starting ${date} ${time}.`);
    });

  const polish = () =>
    start(async () => {
      setNotice(null);
      setPolishing(true);
      const res = await polishTargetsAction({ title: src.title, hook, body, hasCta, targets: chosen.map((t) => ({ key: t.key, channel: t.channel, groupId: t.groupId, body: draftFor(src, t).body })) });
      setPolishing(false);
      const n = Object.keys(res).length;
      if (!n) {
        setNotice("No AI drafts came back. Check your AI key on Settings (it may be past today's cap), or keep the rule-based versions.");
        return;
      }
      setCustomize(true);
      setOverrides((o) => ({ ...o, ...res }));
      setNotice(`AI rewrote ${n} versions in your voice. Review each tab, then schedule.`);
    });

  const preview = previewTab === "all" ? chosen : chosen.filter((t) => t.key === previewTab);

  return (
    <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
      {/* Left: compose */}
      <div className="space-y-4">
        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="label">Post to</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {targets.map((t) => {
                  const on = selected.includes(t.key);
                  return (
                    <button key={t.key} type="button" onClick={() => toggle(t.key)} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-accent bg-accent-soft text-ink" : "text-ink-2 hover:border-ink"}`} title={t.label}>
                      {t.icon} {t.label.replace("Facebook ", "FB ").replace(" caption", "").replace(" community", "").replace(" (FB / IG)", "")}
                    </button>
                  );
                })}
              </div>
              <button type="button" className="mt-1 text-[11px] text-ink-3 underline" onClick={() => setSelected([])}>
                Clear all
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={customize} onChange={(e) => setCustomize(e.target.checked)} /> Customize for each channel
            </label>
          </div>

          {customize && chosen.length ? (
            <div className="mt-4 flex gap-1 overflow-x-auto border-b">
              {[{ key: "all" as const, icon: "✏️", label: "Source" }, ...chosen].map((t) => (
                <button key={t.key} type="button" onClick={() => setTab(t.key as TargetKey | "all")} className={`shrink-0 border-b-2 px-3 py-1.5 text-xs ${tab === t.key ? "border-accent font-semibold" : "border-transparent text-ink-2"}`}>
                  {t.icon} {"label" in t ? t.label.split(" ")[0] : ""}
                  {t.key !== "all" && overrides[t.key] ? " •" : ""}
                </button>
              ))}
            </div>
          ) : null}

          {active && activeDraft ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-ink-3">
                <span>
                  {active.icon} {active.label} · {overrides[active.key] ? "customized" : "auto-formatted from the source"}
                </span>
                <span className={activeDraft.body.length > active.maxChars ? "font-semibold text-danger" : ""}>
                  {activeDraft.body.length}/{active.maxChars}
                </span>
              </div>
              {active.channel === "email" ? <input className="field" value={activeDraft.subject ?? ""} onChange={(e) => setOverride(active.key, { subject: e.target.value })} placeholder="Subject line" /> : null}
              <textarea className="field min-h-56 text-sm" value={activeDraft.body} onChange={(e) => setOverride(active.key, { body: e.target.value })} />
              {activeDraft.checks ? (
                <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  {activeDraft.checks.map((c) => (
                    <li key={c.key} title={c.note} className={c.ok ? "text-good" : "text-warn"}>
                      {c.ok ? "✓" : "!"} {c.label}
                    </li>
                  ))}
                </ul>
              ) : null}
              {overrides[active.key] ? (
                <button type="button" className="text-xs underline" onClick={() => setOverrides((o) => { const n = { ...o }; delete n[active.key]; return n; })}>
                  Reset to auto-format
                </button>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <input className="field font-medium" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Working title (for your content board)" />
              <input className="field" value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Hook: the first line. If it doesn't stop the scroll, nothing else matters." />
              <textarea className="field min-h-48 text-[15px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type content. One line per thought. Line breaks between thoughts." />
              <div className="flex flex-wrap items-center gap-1.5">
                {aiEnabled ? (
                  <button type="button" onClick={polish} disabled={pending || !chosen.length || !(body || hook)} className="btn btn-accent btn-sm">
                    ✨ AI: shape for every channel
                  </button>
                ) : (
                  <a href="/settings#ai" className="rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-ink-3 underline" title="Connect your own Anthropic or OpenAI key">
                    ✨ Connect your AI key in Settings
                  </a>
                )}
                <span className="mx-1 h-5 w-px bg-line" />
                {EMOJI.map((e) => (
                  <button key={e} type="button" className="rounded px-1 text-base hover:bg-surface-2" onClick={() => setBody((b) => b + e)}>
                    {e}
                  </button>
                ))}
                <span className="mx-1 h-5 w-px bg-line" />
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => insert(hashtagsFor(src))}>
                  # Hashtags
                </button>
                {snippets?.hooks.length ? (
                  <select className="field w-auto py-1 text-xs" value="" onChange={(e) => { const h = snippets.hooks.find((x) => x.id === e.target.value); if (h) setHook(h.text); }} aria-label="Pick a hook from the library">
                    <option value="">🪝 Hook from library</option>
                    {snippets.hooks.map((h) => (
                      <option key={h.id} value={h.id}>{h.title}</option>
                    ))}
                  </select>
                ) : null}
                {snippets?.ctas.length ? (
                  <select className="field w-auto py-1 text-xs" value="" onChange={(e) => { const c = snippets.ctas.find((x) => x.id === e.target.value); if (c) { insert(c.text); setHasCta(true); } }} aria-label="Pick a CTA from the library">
                    <option value="">🎯 CTA from library</option>
                    {snippets.ctas.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                ) : (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => insert("Comment \"more\" and I'll send you the full breakdown.")}>
                    + CTA line
                  </button>
                )}
                <label className="ml-auto flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={hasCta} onChange={(e) => setHasCta(e.target.checked)} /> Has a call to action
                </label>
              </div>
              <AiStatus feature="composer_polish" active={pending && polishing} />
              {aiEnabled ? <p className="text-xs text-ink-3" data-testid="ai-promise" data-enabled="1">✨ Returns one version of this draft per target you ticked, inside each one&apos;s limit. You review each tab before you schedule.</p> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="field text-sm" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="Photo or video URL (optional)" />
                <select className="field text-sm" value={contentType} onChange={(e) => setContentType(e.target.value)}>
                  {CONTENT_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </section>

        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="label">Date</span>
              <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Time</span>
              <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={stagger} onChange={(e) => setStagger(e.target.checked)} /> Stagger 45 min apart (your group first, long-form last)
            </label>
          </div>
          {stagger && chosen.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
              {chosen
                .slice()
                .sort((a, b) => (schedule.get(a.key) ?? "").localeCompare(schedule.get(b.key) ?? ""))
                .map((t) => (
                  <span key={t.key}>
                    {t.icon} {(schedule.get(t.key) ?? "").slice(11, 16)}
                  </span>
                ))}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {problems.length ? (
              <span className="rounded-full border border-danger px-2.5 py-1 text-xs text-danger">
                {problems.length} {problems.length === 1 ? "version needs" : "versions need"} a fix: {problems.map((p) => p.label.split(" ")[0]).join(", ")}
              </span>
            ) : null}
            <span className="flex-1" />
            <button type="button" className="btn btn-ghost" disabled={pending || !chosen.length} onClick={() => submit("draft")}>
              Save for later
            </button>
            <button type="button" className="btn btn-soft" disabled={pending || !chosen.length || problems.length > 0} onClick={() => submit("now")}>
              Post now
            </button>
            <button type="button" className="btn btn-accent" disabled={pending || !chosen.length || problems.length > 0} onClick={() => submit("schedule")}>
              {pending ? "Working…" : `Schedule ${chosen.length} ${chosen.length === 1 ? "post" : "posts"}`}
            </button>
          </div>
          {notice ? (
            <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
              {notice}
              {result ? (
                <>
                  {" "}
                  <Link href={`/content/${result.id}/repurpose`} className="underline">
                    See every version →
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          <p className="mt-2 text-[11px] text-ink-3">Group posts are copied and pasted by you (Facebook has no group API). Profile, page, Instagram, LinkedIn and Threads publish through the Social Planner once GoHighLevel is connected on Integrations.</p>
        </section>
      </div>

      {/* Right: preview */}
      <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Post preview</h2>
          <span className="text-[11px] text-ink-3">{chosen.length} selected</span>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b">
          <button type="button" onClick={() => setPreviewTab("all")} className={`shrink-0 border-b-2 px-3 py-1.5 text-xs ${previewTab === "all" ? "border-accent font-semibold" : "border-transparent text-ink-2"}`}>
            All
          </button>
          {chosen.map((t) => (
            <button key={t.key} type="button" onClick={() => setPreviewTab(t.key)} title={t.label} className={`shrink-0 border-b-2 px-2.5 py-1.5 text-base ${previewTab === t.key ? "border-accent" : "border-transparent opacity-70"}`}>
              {t.icon}
            </button>
          ))}
        </div>
        <div className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
          {preview.length ? (
            preview.map((t) => {
              const d = draftOf(t);
              const over = d.body.length > t.maxChars;
              return (
                <div key={t.key}>
                  <div className="mb-1 flex items-center justify-between text-[11px] text-ink-3">
                    <span>
                      {t.icon} {t.label}
                      {schedule.get(t.key) ? ` · ${(schedule.get(t.key) ?? "").slice(11, 16)}` : ""}
                    </span>
                    <span className={over ? "font-semibold text-danger" : ""}>
                      {d.body.length}/{t.maxChars}
                    </span>
                  </div>
                  <ChannelPreview t={t} d={d} p={persona} media={mediaUrl || undefined} title={src.title} />
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-ink-3">Pick where to post and the preview appears here.</div>
          )}
        </div>
      </aside>
    </div>
  );
}
