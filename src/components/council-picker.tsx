"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PickerSeat } from "@/lib/board-seats";
import { SEAT_AREAS, councilProblem } from "@/lib/engine/board-seats";
import { SubmitButton } from "@/components/submit-button";
import { STYLE_NOTE } from "@/components/board-council-note";

const CHAIRS = ["Left", "Right", "Front left", "Front right"] as const;

/** "Alex Hormozi" from "Alex Hormozi style". */
const personName = (name: string) => name.replace(/\s+style$/i, "").trim();
const areaOf = (s: PickerSeat) => (s.kind === "archetype" ? "Archetype" : s.kind === "custom" ? "Your custom seat" : s.areas.join(" · "));

/**
 * My Board → Choose your council (rev 756 §2): Danno fixed at the head, the four chairs, and the library below them. "Add" fills
 * the chair you tapped, or the next empty one; drag a chair (or a card) onto a chair, or tap two chairs to swap them, which works
 * by keyboard too. Save stays off until there are four seats, one of them an operator, each person once.
 */
export function CouncilPicker({
  seats,
  initial,
  live,
  canEdit,
  action,
  startTab,
  customPanel,
  startChair = null,
}: {
  seats: PickerSeat[];
  initial: string[];
  live: boolean;
  canEdit: boolean;
  action: (fd: FormData) => Promise<void>;
  startTab: string;
  customPanel: ReactNode;
  /** H-290: the chair tapped in the room, selected on arrival so the next Add fills it. */
  startChair?: number | null;
}) {
  const byId = useMemo(() => new Map(seats.map((s) => [s.id, s])), [seats]);
  const [chairs, setChairs] = useState<(string | null)[]>(initial);
  const [picked, setPicked] = useState<number | null>(startChair);
  const [tab, setTab] = useState(startTab);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [say, setSay] = useState("");
  const drag = useRef<{ chair?: number; seat?: string } | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const rows = chairs.map((id) => (id ? (byId.get(id) ?? null) : null));
  const problem = councilProblem(rows.map((r) => (r ? { slug: r.slug, name: r.name, kind: r.kind, isOperator: r.operator } : null)));
  const changed = chairs.join() !== initial.join();
  const seated = new Set(rows.filter(Boolean).map((r) => r!.person));
  const operator = rows.find((r) => r?.operator) ?? null;

  const listed = seats.filter((s) => s.listed);
  const tabs = [
    ...(live ? [{ key: "all", label: "All" }, ...SEAT_AREAS.filter((a) => listed.some((s) => s.areas.includes(a))).map((a) => ({ key: a, label: a }))] : []),
    { key: "archetypes", label: "Archetypes" },
    { key: "custom", label: "My custom seats" },
  ];
  const q = query.trim().toLowerCase();
  const shown = q
    ? listed.filter((s) => `${s.name} ${s.card} ${s.areas.join(" ")}`.toLowerCase().includes(q))
    : listed.filter((s) => (tab === "all" ? s.kind === "expert" : tab === "archetypes" ? s.kind === "archetype" : tab === "custom" ? s.kind === "custom" : s.areas.includes(tab)));

  useEffect(() => {
    if (detail) detailRef.current?.focus();
  }, [detail]);

  /** Put a seat in a chair: the tapped chair, else the next empty one. */
  function add(id: string, into?: number) {
    const seat = byId.get(id)!;
    if (seated.has(seat.person) && !(into !== undefined && rows[into]?.person === seat.person)) {
      setSay(`${seat.name} is already on your council.`);
      return;
    }
    const at = into ?? picked ?? chairs.findIndex((c) => !c);
    if (at < 0) {
      setSay("Your four chairs are full. Tap the chair this seat should take, then add it.");
      return;
    }
    setChairs(chairs.map((c, i) => (i === at ? id : c)));
    setPicked(null);
    setDetail(null);
    setSay(`${seat.name} takes the ${CHAIRS[at].toLowerCase()} chair.`);
  }
  function swap(a: number, b: number) {
    if (a === b) return;
    const next = [...chairs];
    [next[a], next[b]] = [next[b], next[a]];
    setChairs(next);
    setSay(`Swapped the ${CHAIRS[a].toLowerCase()} and ${CHAIRS[b].toLowerCase()} chairs.`);
  }
  function tapChair(i: number) {
    if (!canEdit) return;
    if (picked === null) {
      setPicked(i);
      setSay(`${CHAIRS[i]} chair chosen: tap another chair to swap, or add a seat to put it here.`);
    } else if (picked === i) {
      setPicked(null);
      setSay("");
    } else {
      swap(picked, i);
      setPicked(null);
    }
  }
  function empty(i: number) {
    setChairs(chairs.map((c, j) => (j === i ? null : c)));
    setPicked(null);
    setSay(`The ${CHAIRS[i].toLowerCase()} chair is empty.`);
  }

  const open = detail ? byId.get(detail) : null;

  return (
    <div data-testid="council-picker">
      <section className="card mb-4 p-4 sm:p-5" aria-label="Your council">
        <div className="mb-3 rounded-xl border border-line bg-surface-2 p-3" data-testid="council-head">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Head of the table · Chair</div>
          <div className="font-semibold">Danno</div>
          <p className="text-xs text-ink-3">Always at the head. Guided by Danno&apos;s teaching; it is not Danno live.</p>
        </div>
        <ol className="grid grid-cols-2 gap-2" data-testid="council-chairs">
          {CHAIRS.map((label, i) => {
            const s = rows[i];
            return (
              <li key={label} className="min-w-0">
                <div
                  className={`flex h-full min-w-0 flex-col gap-1 rounded-xl border p-3 ${picked === i ? "border-accent ring-2 ring-accent" : "border-line"}`}
                  draggable={canEdit && Boolean(s)}
                  onDragStart={() => (drag.current = { chair: i })}
                  onDragOver={(e) => canEdit && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const d = drag.current;
                    drag.current = null;
                    if (d?.chair !== undefined) swap(d.chair, i);
                    else if (d?.seat) add(d.seat, i);
                  }}
                  data-testid={`council-chair-${i}`}
                  data-seat={s?.slug ?? ""}
                >
                  <button type="button" className="min-w-0 text-left" onClick={() => tapChair(i)} aria-pressed={picked === i} disabled={!canEdit} data-testid={`council-chair-${i}-tap`}>
                    <span className="block text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</span>
                    <span className="block font-semibold" data-testid={`council-chair-${i}-name`}>
                      {s ? s.name : "Empty"}
                    </span>
                    {s ? <span className="block text-xs text-ink-3">{areaOf(s)}</span> : <span className="block text-xs text-ink-3">Add a seat from the library</span>}
                  </button>
                  <span className="flex flex-wrap gap-1">
                    {s && operator?.id === s.id ? <span className="badge badge-accent">Operator: owns the steps</span> : s?.operator ? <span className="badge">Operator</span> : null}
                    {s?.paused ? <span className="badge badge-warn">Paused</span> : null}
                    {s?.retired ? <span className="badge badge-warn">Retired</span> : null}
                    {s?.myRead ? <span className="badge">My read</span> : null}
                  </span>
                  {s && canEdit ? (
                    <button type="button" className="self-start text-xs text-ink-3 underline" onClick={() => empty(i)} aria-label={`Empty the ${label.toLowerCase()} chair`} data-testid={`council-chair-${i}-empty`}>
                      Remove
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-ink-3">The Board speaks in this order: Danno, left, right, front left, front right. Tap two chairs to swap them, or drag one onto another.</p>
        {rows.some((r) => r?.paused) ? <p className="mt-1 text-xs text-ink-3" data-testid="council-paused-note">Paused seats sit out while expert seats are off: a classic seat takes the chair, and your pick comes back when they&apos;re on again.</p> : null}
        <p className="mt-1 text-xs text-ink-3" data-testid="council-style-note">
          {STYLE_NOTE}
        </p>
        <p className="sr-only" aria-live="polite" data-testid="council-say">
          {say}
        </p>
        {say ? (
          <p className="mt-2 text-sm text-ink-2" aria-hidden data-testid="council-said">
            {say}
          </p>
        ) : null}
        {canEdit ? (
          <form action={action} className="mt-3 flex flex-wrap items-center gap-3" data-testid="council-save-form">
            {chairs.map((id, i) => (
              <input key={i} type="hidden" name={`chair${i}`} value={id ?? ""} />
            ))}
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" disabled={Boolean(problem) || !changed} data-testid="council-save">
              Save my council
            </SubmitButton>
            {problem ? (
              <span className="min-w-0 text-sm text-warn" role="status" data-testid="council-problem">
                {problem}
              </span>
            ) : !changed ? (
              <span className="min-w-0 text-sm text-ink-3">This is your council now.</span>
            ) : null}
          </form>
        ) : null}
      </section>

      <section className="card p-4 sm:p-5" aria-label="The seat library">
        <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Skill areas" data-testid="council-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={!q && tab === t.key}
              className={`btn btn-sm ${!q && tab === t.key ? "btn-primary" : "btn-ghost"}`}
              onClick={() => {
                setTab(t.key);
                setQuery("");
              }}
              data-testid={`council-tab-${t.key === "all" ? "all" : t.key === "archetypes" ? "archetypes" : t.key === "custom" ? "custom" : "area"}`}
              data-area={t.key}
            >
              {t.label}
            </button>
          ))}
        </div>
        {!live ? <p className="mb-3 text-sm text-ink-3" data-testid="council-experts-off">The expert style-advisor seats open when your coach turns them on. Until then, choose from the archetypes and your own custom seats.</p> : null}
        <label className="mb-3 block">
          <span className="sr-only">Search the seats</span>
          <input className="field" type="search" placeholder="Search by name, skill or what they focus on" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="council-search" />
        </label>
        {!q && tab === "custom" ? customPanel : null}
        {shown.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="council-cards">
            {shown.map((s) => {
              const on = chairs.includes(s.id);
              const taken = !on && seated.has(s.person);
              return (
                <li
                  key={s.id}
                  className="flex min-w-0 flex-col gap-2 rounded-xl border border-line p-3"
                  draggable={canEdit && !on && !taken}
                  onDragStart={() => (drag.current = { seat: s.id })}
                  data-testid="council-card"
                  data-slug={s.slug}
                >
                  <div className="min-w-0">
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-xs text-ink-3">{areaOf(s)}</div>
                  </div>
                  <p className="text-sm text-ink-2">{s.card}</p>
                  <span className="flex flex-wrap gap-1">
                    {s.operator ? <span className="badge badge-accent">Operator</span> : null}
                    {s.myRead ? (
                      <span className="badge" data-testid="council-card-my-read">
                        My read only: no sources given
                      </span>
                    ) : null}
                  </span>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setDetail(s.id)} data-testid="council-card-open">
                      Details
                    </button>
                    {canEdit ? (
                      <button type="button" className="btn btn-soft btn-xs" onClick={() => add(s.id)} disabled={on || taken} data-testid="council-card-add">
                        {on ? "On your council" : taken ? "Already seated" : "Add"}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : q || tab !== "custom" ? (
          <p className="text-sm text-ink-3">No seats match.</p>
        ) : null}
      </section>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setDetail(null)} data-testid="council-detail-backdrop">
          <div
            ref={detailRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="council-detail-name"
            className="card max-h-[85vh] w-full max-w-lg overflow-y-auto p-4 sm:p-5"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && setDetail(null)}
            data-testid="council-detail"
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="council-detail-name" className="text-lg font-semibold">
                  {open.name}
                </h2>
                <p className="text-xs text-ink-3">{areaOf(open)}</p>
                {open.realPerson ? (
                  <p className="text-sm text-ink-2" data-testid="council-detail-inspired">
                    Inspired by {personName(open.name)}&apos;s public work
                  </p>
                ) : null}
              </div>
              <button type="button" className="btn btn-ghost btn-xs shrink-0" onClick={() => setDetail(null)} data-testid="council-detail-close">
                Close
              </button>
            </div>
            {open.myRead ? <p className="mb-2 text-sm text-ink-3">No sources were given for this seat, so everything it says is labelled &quot;my read&quot;.</p> : null}
            <h3 className="mt-3 text-sm font-semibold">Purpose</h3>
            <p className="text-sm text-ink-2">{open.purpose}</p>
            {open.questions.length ? (
              <>
                <h3 className="mt-3 text-sm font-semibold">The questions it asks</h3>
                <ul className="list-disc pl-5 text-sm text-ink-2">
                  {open.questions.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {open.frameworks.length ? (
              <>
                <h3 className="mt-3 text-sm font-semibold">Key frameworks</h3>
                <ul className="grid gap-1 text-sm text-ink-2">
                  {open.frameworks.map((f) => (
                    <li key={f.name}>
                      <span className="font-medium">{f.name}:</span> {f.text}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {open.voice ? (
              <>
                <h3 className="mt-3 text-sm font-semibold">Voice</h3>
                <p className="text-sm text-ink-2">{open.voice}</p>
              </>
            ) : null}
            {open.sources.length ? (
              <>
                <h3 className="mt-3 text-sm font-semibold">Public sources</h3>
                <ul className="grid gap-1 text-sm" data-testid="council-detail-sources">
                  {open.sources.map((x) => (
                    <li key={x.label + (x.url ?? "")}>
                      {x.url ? (
                        <a href={x.url} target="_blank" rel="noopener noreferrer" className="underline">
                          {x.label}
                        </a>
                      ) : (
                        x.label
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {open.kind !== "archetype" ? <p className="mt-3 text-xs text-ink-3">{STYLE_NOTE}</p> : null}
            {canEdit ? (
              <button type="button" className="btn btn-primary btn-sm mt-4" onClick={() => add(open.id)} disabled={chairs.includes(open.id) || seated.has(open.person)} data-testid="council-detail-add">
                {chairs.includes(open.id) ? "On your council" : seated.has(open.person) ? "Already seated" : "Add to my council"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
