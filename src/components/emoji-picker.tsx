"use client";

/**
 * The emoji picker (H-94): a button showing the current emoji opens a grid of about sixty in five groups with a search box;
 * the current one first and highlighted; a pick saves at once and closes; Escape or a tap outside closes without saving;
 * Tab, the arrows and Enter work and each emoji is announced by name; "Other…" takes one typed emoji. Every target is 44px.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { setAvatarEmojiAction } from "@/lib/actions/settings";
import { EMOJI_GROUPS, emojiName, isOneEmoji, searchEmoji, type EmojiItem } from "@/lib/engine/emoji";

const COLS = 6;

export function EmojiPicker({ current }: { current: string }) {
  const [value, setValue] = useState(current);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [other, setOther] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (e: string) =>
    start(async () => {
      setError(null);
      const r = await setAvatarEmojiAction(e);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setValue(e);
      setOpen(false);
      setOther(false);
      setTyped("");
      setQ("");
      button.current?.focus();
    });

  // Arrows move within the grid of buttons; Enter and Space pick (a button's own click).
  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"];
    if (!keys.includes(e.key)) return;
    const buttons = [...(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-emoji]") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? COLS : -COLS;
    buttons[Math.max(0, Math.min(buttons.length - 1, at + step))]?.focus();
  };

  const found = searchEmoji(q);
  const groups: { name: string; items: EmojiItem[] }[] = q.trim() ? [{ name: "Found", items: found }] : EMOJI_GROUPS;
  // The current one first, in its own row, whatever the search.
  const currentItem: EmojiItem = { e: value, name: emojiName(value) };
  const cell = (i: EmojiItem) => (
    <button
      key={i.e}
      type="button"
      className={`grid h-11 w-11 place-items-center rounded-lg text-2xl hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent${i.e === value ? " ring-2 ring-accent bg-surface-2" : ""}`}
      aria-label={i.name}
      aria-pressed={i.e === value}
      data-emoji={i.e}
      data-testid="emoji-option"
      disabled={pending}
      onClick={() => pick(i.e)}
    >
      <span aria-hidden="true">{i.e}</span>
    </button>
  );
  return (
    <div ref={box} className="relative inline-block">
      <button ref={button} type="button" className="field flex h-11 w-16 items-center justify-center text-2xl" aria-haspopup="dialog" aria-expanded={open} aria-label={`Your emoji: ${emojiName(value)}. Change it`} onClick={() => setOpen((o) => !o)} data-testid="emoji-button">
        <span aria-hidden="true">{value}</span>
      </button>
      {open ? (
        <div role="dialog" aria-label="Pick your emoji" className="absolute left-0 z-30 mt-1 w-[min(21rem,calc(100vw-2rem))] rounded-xl border bg-surface p-3 shadow-lg" data-testid="emoji-grid">
          <input type="search" className="field mb-2" placeholder="Search: trident, fire…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search emojis" autoFocus data-testid="emoji-search" />
          <div className="max-h-72 space-y-2 overflow-y-auto" onKeyDown={onGridKey}>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Now</p>
              <div className="grid grid-cols-6 gap-1">{cell(currentItem)}</div>
            </div>
            {groups.map((g) => (
              <div key={g.name}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{g.name}</p>
                <div className="grid grid-cols-6 gap-1" role="group" aria-label={g.name}>
                  {g.items.filter((i) => i.e !== value).map(cell)}
                </div>
                {g.items.length === 0 ? <p className="text-xs text-ink-3">Nothing by that name. Try Other…</p> : null}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
            {other ? (
              <>
                <input className="field h-11 w-20 text-center text-xl" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={16} aria-label="Type one emoji" data-testid="emoji-other-input" />
                <button type="button" className="btn btn-soft btn-sm" disabled={pending || !isOneEmoji(typed)} onClick={() => pick(typed.trim())} data-testid="emoji-other-save">
                  Use it
                </button>
              </>
            ) : (
              <button type="button" className="min-h-11 text-xs underline" onClick={() => setOther(true)} data-testid="emoji-other">
                Other…
              </button>
            )}
            {error ? <span className="text-xs text-danger" role="alert" data-testid="emoji-error">{error}</span> : null}
            {pending ? <span className="text-xs text-ink-3">Saving…</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
