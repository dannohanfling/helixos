"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Pull down to refresh, inside the HelixOS app only (H-1761, plan H-1768). One web version for iPhone and Android, because
 * it can see what's on the page: it starts only at the very top, refreshes the page's data in place (router.refresh: no
 * full reload, no opening replay, typed text and scroll kept), ticks the phone once the pull passes the point where letting
 * go refreshes, and stays off where a pull would fight something else.
 */
const THRESHOLD = 70; // px of indicator travel at which letting go refreshes
const MAX = 110;
const CHAT_PATHS = ["/ask", "/socrates", "/link-chat"];

type Haptics = { impact?: (o: { style: string }) => Promise<void> };
const haptics = (): Haptics | null =>
  ((window as unknown as { Capacitor?: { Plugins?: { Haptics?: Haptics } } }).Capacitor?.Plugins?.Haptics as Haptics | undefined) ?? null;

/** True when a pull starting on this element should do nothing: a drag surface, a control or an inner scroller. */
export function blockedTarget(el: Element | null): boolean {
  for (let n: Element | null = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n.matches("[data-no-pull], input, textarea, select, canvas, video, iframe, [contenteditable=''], [contenteditable='true']")) return true;
    const s = window.getComputedStyle(n);
    // Anything that handles its own touches (the living scenes, maps, carousels, sliders set touch-action).
    if (s.touchAction && !["auto", "manipulation", "pan-y", "pan-y pinch-zoom", "pinch-zoom pan-y"].includes(s.touchAction)) return true;
    // A sideways strip, or an inner area that can scroll up: the finger belongs to it.
    if (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) return true;
  }
  return false;
}

/** An open sheet, modal or dialog anywhere on the page turns the pull off. */
export function dialogOpen(): boolean {
  return Boolean(document.querySelector("dialog[open], [role='dialog']:not([hidden]), [aria-modal='true']"));
}

/** Unsaved typing: any field whose value differs from what the page loaded with. */
export function hasUnsavedText(root: ParentNode = document): boolean {
  for (const f of Array.from(root.querySelectorAll("input, textarea, select"))) {
    if (f instanceof HTMLInputElement) {
      if (["hidden", "submit", "button", "reset", "file"].includes(f.type)) continue;
      if (f.type === "checkbox" || f.type === "radio" ? f.checked !== f.defaultChecked : f.value !== f.defaultValue) return true;
    } else if (f instanceof HTMLTextAreaElement) {
      if (f.value !== f.defaultValue) return true;
    } else if (f instanceof HTMLSelectElement) {
      if (Array.from(f.options).some((o) => o.selected !== o.defaultSelected)) return true;
    }
  }
  return false;
}

export function PullRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const [pull, setPull] = useState(0);
  const [note, setNote] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const start = useRef<{ y: number; armed: boolean } | null>(null);
  const passed = useRef(false);
  const off = CHAT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (off) return;
    const atTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;
    const onStart = (e: TouchEvent) => {
      start.current = null;
      if (e.touches.length !== 1 || !atTop() || dialogOpen() || blockedTarget(e.target as Element)) return;
      start.current = { y: e.touches[0].clientY, armed: true };
      passed.current = false;
    };
    const onMove = (e: TouchEvent) => {
      const s = start.current;
      if (!s?.armed) return;
      const dy = e.touches[0].clientY - s.y;
      if (dy <= 0 || !atTop()) {
        if (dy < 0) start.current = null; // scrolling down: not a pull
        setPull(0);
        return;
      }
      e.preventDefault(); // our pull, not the page's bounce
      const d = Math.min(MAX, dy * 0.5);
      setPull(d);
      if (d >= THRESHOLD && !passed.current) {
        passed.current = true;
        void haptics()?.impact?.({ style: "LIGHT" }).catch(() => undefined);
      } else if (d < THRESHOLD) passed.current = false;
    };
    const onEnd = () => {
      const go = start.current?.armed && passed.current;
      start.current = null;
      passed.current = false;
      setPull(0);
      if (!go) return;
      if (hasUnsavedText()) {
        setNote(true);
        window.setTimeout(() => setNote(false), 2500);
        return;
      }
      startRefresh(() => router.refresh());
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [off, router]);

  const shown = refreshing ? THRESHOLD : pull;
  return (
    <>
      <style>{`
        @keyframes helix-pull-spin { to { transform: rotate(360deg); } }
        .helix-pull { position: fixed; left: 50%; top: calc(env(safe-area-inset-top) + 8px); z-index: 60; width: 36px; height: 36px;
          margin-left: -18px; border-radius: 999px; background: var(--surface); box-shadow: 0 1px 4px rgb(0 0 0 / .18);
          display: grid; place-items: center; pointer-events: none; transition: opacity 150ms; }
        .helix-pull span { width: 20px; height: 20px; border-radius: 999px; border: 2.5px solid #DDA33833; border-top-color: #DDA338; }
        .helix-pull[data-refreshing="true"] span { animation: helix-pull-spin 700ms linear infinite; }
        @media (prefers-reduced-motion: reduce) { .helix-pull[data-refreshing="true"] span { animation-duration: 1.6s; } }
      `}</style>
      {shown > 0 ? (
        <div
          className="helix-pull"
          role="status"
          aria-label={refreshing ? "Refreshing" : "Pull to refresh"}
          data-testid="pull-refresh"
          data-refreshing={refreshing ? "true" : "false"}
          data-ready={pull >= THRESHOLD ? "true" : "false"}
          style={{ opacity: Math.min(1, shown / THRESHOLD), transform: `translateY(${shown - 44}px) rotate(${refreshing ? 0 : shown * 4}deg)` }}
        >
          <span />
        </div>
      ) : null}
      {note ? (
        <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] z-[60] flex justify-center px-4" role="status" data-testid="pull-refresh-unsaved">
          <p className="card px-4 py-2 text-sm shadow-lg">Save or clear your changes first.</p>
        </div>
      ) : null}
    </>
  );
}
