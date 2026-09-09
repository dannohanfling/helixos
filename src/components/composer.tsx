"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CONTENT_TYPES } from "@/db/schema";
import { polishTargetsAction, saveComposeAction, type ComposeResult } from "@/lib/actions/compose";
import { pushLadderUpdateAction } from "@/lib/actions/ladders";
import { channelTargets, draftFor, groupTargets, localIso, staggerSchedule, type Draft, type GroupTarget, type Target, type TargetKey } from "@/lib/engine/compose";
import { hashtagsFor } from "@/lib/engine/repurpose";
import { explainFabricated, findFabricated } from "@/lib/engine/blacklist";
import { ChannelPreview, type Persona } from "./channel-previews";
import { AiStatus } from "@/components/ai-status";
import { AiPromise } from "@/components/ai-promise";
import { useVoice } from "@/components/voice-context";
import { CopyButton } from "@/components/copy-button";

type Initial = { id?: string; title?: string; hook?: string; body?: string; cta?: string; hasCta?: boolean; mediaUrl?: string; contentType?: string; overrides?: Record<string, { body: string; subject?: string }>; selected?: string[] };
/** Scheduled channel posts of the ladder this item came from that still carry older text than the ladder (the seam). */
export type StaleNotice = { ladderId: string; back: string; channels: { key: string; label: string; inGhl: boolean }[] };
/** Targets the composer shows and lets the client copy but never schedules, keyed by target, with the reason said beside the draft. */
export type CopyOnly = Partial<Record<string, string>>;

const EMOJI = ["🔥", "✅", "👇", "💡", "🙌", "❤️", "👉", "⚡", "🎯", "😅", "🤝", "📌"];
const DEFAULT_SELECTED: TargetKey[] = ["ch:fb_personal", "ch:instagram", "ch:threads", "ch:linkedin"];

type Snippet = { id: string; title: string; text: string };

export function Composer({ groups, persona, hashtag, today, aiEnabled, socialConnected, initial, snippets, stale, copyOnly }: { groups: GroupTarget[]; persona: Persona; hashtag: string | null; today: string; aiEnabled: boolean; socialConnected: boolean; initial?: Initial; snippets?: { hooks: Snippet[]; ctas: Snippet[]; proofs?: Snippet[] }; stale?: StaleNotice; copyOnly?: CopyOnly }) {
  const router = useRouter();
  const voice = useVoice();
  const targets = useMemo(() => [...groupTargets(groups), ...channelTargets()], [groups]);
  const byKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [hook, setHook] = useState(initial?.hook ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  // The CTA is its own field. Picking one replaces it; each channel version places it once at render. It is never appended to the body.
  const [cta, setCta] = useState(initial?.cta ?? "");
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

  const src = useMemo(() => ({ title: title || hook.slice(0, 60), hook, body, hasCta, ctaText: cta, hashtag, firstName: persona.name.split(" ")[0] }), [title, hook, body, hasCta, cta, hashtag, persona.name]);
  const chosen = useMemo(() => selected.map((k) => byKey.get(k)).filter((t): t is Target => Boolean(t)), [selected, byKey]);
  // A copy-only target (a Threads chain from a ladder) is shown and copied here but never scheduled or polished as one post.
  const copyOnlyReason = (t: Target): string | undefined => copyOnly?.[t.key];
  const schedulable = useMemo(() => chosen.filter((t) => !copyOnly?.[t.key]), [chosen, copyOnly]);
  const draftOf = (t: Target): Draft => {
    const auto = draftFor(src, t);
    const o = customize ? overrides[t.key] : undefined;
    return o ? { ...auto, body: o.body, subject: o.subject ?? auto.subject } : auto;
  };
  const schedule = useMemo(() => (stagger ? staggerSchedule(schedulable, localIso(date, time)) : new Map(schedulable.map((t) => [t.key, `${date}T${time}`]))), [schedulable, stagger, date, time]);
  const problems = schedulable.filter((t) => {
    const d = draftOf(t);
    return !d.body.trim() || d.body.length > t.maxChars || findFabricated(d.body).length > 0;
  });
  // Block on truth: a fabricated statistic blocks scheduling and posting, and the block says why and what to say instead.
  const proofQuotes = (snippets?.proofs ?? []).map((p) => p.text);
  const fabricatedIn = (body: string) => {
    const m = findFabricated(body);
    return m.length ? explainFabricated(m, { text: body, quotes: proofQuotes }) : null;
  };
  const active = tab !== "all" ? byKey.get(tab) : undefined;
  const activeDraft = active ? draftOf(active) : null;

  const toggle = (k: TargetKey) => {
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
    if (tab === k) setTab("all");
    if (previewTab === k) setPreviewTab("all");
  };
  /** Adds a line to the body once: a second press of the same button changes nothing. */
  const insert = (text: string) => setBody((b) => (b.includes(text) ? b : b ? `${b}${b.endsWith("\n") ? "" : "\n"}${text}` : text));
  const chooseCta = (text: string) => {
    setCta(text);
    setHasCta(true);
  };
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
        cta,
        hasCta,
        mediaUrl,
        contentType,
        mode,
        targets: schedulable.map((t) => {
          const d = draftOf(t);
          const at = schedule.get(t.key);
          return { key: t.key, channel: t.channel, groupId: t.groupId, body: d.body, subject: d.subject, postAt: mode === "schedule" && at ? `${at}:00` : null };
        }),
      };
      const r = await saveComposeAction(payload);
      if (r.blocked) {
        setNotice(r.blocked);
        return;
      }
      setResult(r);
      if (mode === "draft") router.push(`/content/${r.id}/repurpose`);
      else setNotice(mode === "now" ? `Posted to ${r.posted} places. Groups are ready to paste; channels went to the Social Planner${socialConnected ? "" : " queue (connect GoHighLevel to auto-publish)"}.` : `Scheduled ${r.scheduled} posts starting ${date} ${time}.`);
    });

  const polish = () =>
    start(async () => {
      setNotice(null);
      setPolishing(true);
      const { drafts: res, removed } = await polishTargetsAction({ title: src.title, hook, body, cta, hasCta, targets: schedulable.map((t) => ({ key: t.key, channel: t.channel, groupId: t.groupId, body: draftFor(src, t).body })) });
      setPolishing(false);
      const n = Object.keys(res).length;
      if (!n) {
        setNotice("No AI drafts came back. Check your AI key on Settings (it may be past today's cap), or keep the rule-based versions.");
        return;
      }
      setCustomize(true);
      setOverrides((o) => ({ ...o, ...res }));
      setNotice(`AI rewrote ${n} versions${voice.ready ? " in your voice" : ""}. Review each tab, then schedule.${removed ? `\n\n${removed}` : ""}`);
    });

  const preview = previewTab === "all" ? chosen : chosen.filter((t) => t.key === previewTab);

  return (
    <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
      {/* Left: compose */}
      <div className="space-y-4">
        {stale?.channels.length ? (
          <div className="rounded-xl border bg-warn-soft p-3 text-sm" data-testid="stale-scheduled" role="status">
            <div className="font-semibold">Scheduled with the old text: {stale.channels.map((c) => c.label).join(", ")}.</div>
            <p className="mt-0.5 text-xs text-ink-2">
              The ladder changed after these were scheduled. Nothing in the schedule was touched.{" "}
              {stale.channels.some((c) => c.inGhl) ? "Pushing the update edits the post GoHighLevel holds, under the same id, at the same time." : "These are scheduled here and pasted by hand, so pushing the update replaces their text only."}
            </p>
            <form action={pushLadderUpdateAction} className="mt-2">
              <input type="hidden" name="id" value={stale.ladderId} />
              <input type="hidden" name="back" value={stale.back} />
              <button type="submit" className="btn btn-soft btn-sm" data-testid="push-update">
                Push the update to GoHighLevel
              </button>
            </form>
          </div>
        ) : null}
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
              {fabricatedIn(activeDraft.body) ? (
                <p className="whitespace-pre-line rounded-lg border border-danger bg-danger-soft p-2 text-xs" data-testid="fabricated-block" role="alert">
                  {fabricatedIn(activeDraft.body)}
                </p>
              ) : null}
              {copyOnlyReason(active) ? (
                <p className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft p-2 text-xs" data-testid="copy-only" role="status">
                  <span>{copyOnlyReason(active)}</span>
                  <CopyButton text={activeDraft.body} label="Copy the chain" className="btn btn-soft btn-xs" />
                </p>
              ) : activeDraft.body.length > active.maxChars ? (
                <p className="text-xs text-danger" data-testid="over-limit" role="status">
                  Over the {active.maxChars}-character limit for {active.label}.
                </p>
              ) : null}
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
              <input
                className="field text-sm"
                value={cta}
                onChange={(e) => {
                  setCta(e.target.value);
                  if (e.target.value.trim()) setHasCta(true);
                }}
                placeholder="Call to action: the closing line. Kept apart from the body and placed once on every version."
                aria-label="Call to action"
                data-testid="cta-field"
              />
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
                {snippets?.proofs?.length ? (
                  <select className="field w-auto py-1 text-xs" value="" onChange={(e) => { const p = snippets.proofs?.find((x) => x.id === e.target.value); if (p) insert(p.text); }} aria-label="Pick a proof from the bank">
                    <option value="">🏆 Proof from the bank</option>
                    {snippets.proofs.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                ) : null}
                {snippets?.ctas.length ? (
                  <select className="field w-auto py-1 text-xs" value="" onChange={(e) => { const c = snippets.ctas.find((x) => x.id === e.target.value); if (c) chooseCta(c.text); }} aria-label="Pick a CTA from the library">
                    <option value="">🎯 CTA from library</option>
                    {snippets.ctas.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                ) : null}
                <label className="ml-auto flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={hasCta} onChange={(e) => setHasCta(e.target.checked)} /> Has a call to action
                </label>
              </div>
              <AiStatus feature="composer_polish" active={pending && polishing} />
              {aiEnabled ? <AiPromise enabled>Returns one version of this draft per target you ticked, inside each one&apos;s limit. You review each tab before you schedule.</AiPromise> : null}
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
            <button type="button" className="btn btn-soft" disabled={pending || !schedulable.length || problems.length > 0} onClick={() => submit("now")}>
              Post now
            </button>
            <button type="button" className="btn btn-accent" disabled={pending || !schedulable.length || problems.length > 0} onClick={() => submit("schedule")}>
              {pending ? "Working…" : `Schedule ${chosen.length} ${chosen.length === 1 ? "post" : "posts"}`}
            </button>
          </div>
          {notice ? (
            <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-line">
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
              const reason = copyOnlyReason(t);
              const over = !reason && d.body.length > t.maxChars;
              return (
                <div key={t.key}>
                  <div className="mb-1 flex items-center justify-between text-[11px] text-ink-3">
                    <span>
                      {t.icon} {t.label}
                      {schedule.get(t.key) ? ` · ${(schedule.get(t.key) ?? "").slice(11, 16)}` : ""}
                    </span>
                    {reason ? (
                      <span>{d.body.split(/\n\n+/).filter(Boolean).length} posts · copy only</span>
                    ) : (
                      <span className={over ? "font-semibold text-danger" : ""}>
                        {d.body.length}/{t.maxChars}
                      </span>
                    )}
                  </div>
                  {reason ? (
                    <p className="mb-1 flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft p-2 text-[11px]" data-testid="copy-only" role="status">
                      <span>{reason}</span>
                      <CopyButton text={d.body} label="Copy the chain" className="btn btn-soft btn-xs" />
                    </p>
                  ) : null}
                  {over ? <p className="mb-1 text-[11px] text-danger">Over the {t.maxChars}-character limit for {t.label}.</p> : null}
                  {fabricatedIn(d.body) ? (
                    <p className="mb-1 whitespace-pre-line rounded-lg border border-danger bg-danger-soft p-2 text-[11px]" data-testid="fabricated-block" role="alert">
                      {fabricatedIn(d.body)}
                    </p>
                  ) : null}
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
