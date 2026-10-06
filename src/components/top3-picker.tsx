"use client";

import { useState, useTransition } from "react";
import { addTodayTaskAction, removeTodayTaskAction } from "@/lib/actions/daily";

type Item = { id: string; title: string; late: boolean; added?: boolean; /** "today", or the day it is due ("3 Oct"). */ due?: string };
export const TOP3 = 3;

/**
 * "Pick your top 3" in the morning lock-in (handoff rev 157). Add (or Enter) puts a typed task straight into the list as a real
 * task for today, ticked while fewer than three are, and clears the box for the next one; one tap takes an added one back.
 * Only three can be ticked: past the third, a new task goes in unticked with a quiet line. The ticks are what Lock it in sends.
 */
export function Top3Picker({ candidates, initiallyChecked, carried }: { candidates: Item[]; initiallyChecked: string[]; carried?: { label: string; ids: string[] } }) {
  const [items, setItems] = useState<Item[]>(candidates);
  const [checked, setChecked] = useState<string[]>(initiallyChecked.slice(0, TOP3));
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ tone: "good" | "quiet" | "danger"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const toggle = (id: string, on: boolean) => {
    if (on && checked.length >= TOP3) {
      setNote({ tone: "quiet", text: "You've picked 3. Untick one to swap." });
      return;
    }
    setNote(null);
    setChecked((c) => (on ? [...c, id] : c.filter((x) => x !== id)));
  };
  const add = () => {
    const title = text.trim();
    if (!title || pending) return;
    start(async () => {
      const r = await addTodayTaskAction(title);
      if (!r.ok) {
        setNote({ tone: "danger", text: r.error });
        return;
      }
      setText("");
      setItems((xs) => (xs.some((x) => x.id === r.task.id) ? xs : [...xs, { id: r.task.id, title: r.task.title, late: false, added: true }]));
      const room = checked.length < TOP3 || checked.includes(r.task.id);
      if (room && !checked.includes(r.task.id)) setChecked((c) => [...c, r.task.id]);
      setNote(room ? { tone: "good", text: "Task added ✓" } : { tone: "quiet", text: "Task added ✓ You've picked 3. Untick one to swap." });
    });
  };
  const remove = (id: string) => {
    start(async () => {
      await removeTodayTaskAction(id);
      setItems((xs) => xs.filter((x) => x.id !== id));
      setChecked((c) => c.filter((x) => x !== id));
      setNote(null);
    });
  };

  // One row per task, the whole title (two lines, then … with the rest on hover or a long press), its late tag and due day
  // (rev 531: two columns of chips cut every title to eight letters, so tasks couldn't be told apart).
  const row = (t: Item) => (
    <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-lg border bg-surface px-2.5 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft" data-testid="top3-item" data-added={t.added ? "yes" : "no"}>
      <input type="checkbox" className="mt-0.5" name="focus" value={t.id} checked={checked.includes(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} />
      <span className="min-w-0 flex-1 line-clamp-2" title={t.title} data-testid="top3-title">{t.title}</span>
      {t.late ? <span className="shrink-0 text-[10px] font-semibold uppercase text-danger">late</span> : null}
      {t.due ? <span className="shrink-0 text-[11px] text-ink-3" data-testid="top3-due">{t.due === "today" ? "due today" : `due ${t.due}`}</span> : null}
      {t.added ? (
        <button type="button" className="shrink-0 rounded px-1 text-ink-3 hover:text-danger" aria-label={`Remove ${t.title}`} onClick={(e) => { e.preventDefault(); remove(t.id); }} data-testid="top3-remove">
          ×
        </button>
      ) : null}
    </label>
  );
  const carriedItems = carried ? items.filter((t) => carried.ids.includes(t.id)) : [];

  return (
    <div data-testid="top3-picker">
      <div className="flex items-baseline justify-between">
        <div className="label">Pick your top 3</div>
        <span className={`text-xs ${checked.length === TOP3 ? "font-semibold text-good" : "text-ink-3"}`} data-testid="top3-count">
          {checked.length} of {TOP3} picked
        </span>
      </div>
      {carried && carriedItems.length ? (
        <>
          <div className="mb-1 text-xs font-medium text-ink-2" data-testid="top3-carried-label">
            {carried.label}
          </div>
          <div className="mb-2 grid grid-cols-1 gap-1" data-testid="top3-carried">
            {carriedItems.map(row)}
          </div>
          <div className="mb-1 text-xs font-medium text-ink-2">Everything else</div>
        </>
      ) : null}
      <div className="grid grid-cols-1 gap-1">
        {items.filter((t) => !carried?.ids.includes(t.id)).map(row)}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Enter adds the task; it never sends the lock-in.
              e.preventDefault();
              add();
            }
          }}
          placeholder="…or type a new task"
          aria-label="A new task for today"
          data-testid="top3-new"
        />
        <button type="button" className="btn btn-soft btn-sm shrink-0" onClick={add} disabled={pending || !text.trim()} aria-busy={pending} data-testid="top3-add">
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {note ? (
        <p role="status" aria-live="polite" className={`mt-1 text-sm ${note.tone === "good" ? "font-medium text-good" : note.tone === "danger" ? "text-danger" : "text-ink-2"}`} data-testid="top3-note">
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
