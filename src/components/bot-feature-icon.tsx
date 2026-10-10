import type { BotFeature, FeatureState } from "@/lib/engine/bot-features";

/**
 * Bot Features' line icons (rev 618 design): Lucide-style, 24px, stroke 2, drawn in code. Decorative, so hidden from screen
 * readers; the lock is the one icon that carries meaning, and says so.
 */
const PATHS: Record<BotFeature["icon"], string[]> = {
  "calendar-check": ["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "m9 16 2 2 4-4"],
  gift: ["M3 8h18v4H3z", "M12 8v13", "M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7", "M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"],
  ticket: ["M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z", "M13 5v2", "M13 17v2", "M13 11v2"],
  star: ["M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"],
  undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  award: ["M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12z", "M8.21 13.89 7 23l5-3 5 3-1.21-9.12"],
  ladder: ["M7 2v20", "M17 2v20", "M7 6h10", "M7 11h10", "M7 16h10"],
};

export function FeatureIcon({ icon, size = 24 }: { icon: BotFeature["icon"]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[icon].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The lock: "Locked" to a screen reader where it stands alone; hidden inside the chip, whose own word says it. */
export function LockIcon({ size = 12, decorative = false }: { size?: number; decorative?: boolean }) {
  const a11y = decorative ? { "aria-hidden": true as const, focusable: "false" as const } : { role: "img", "aria-label": "Locked" };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...a11y}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

const CHIP: Record<FeatureState, string> = { on: "On", unlocked: "Unlocked", requested: "Requested", locked: "Locked", coming_soon: "Coming soon" };

/** The status chip (12px, bold, uppercase pill): gold for On, a gold outline for Unlocked and Requested, a lock for Locked. */
export function Chip({ state }: { state: FeatureState }) {
  return (
    <span className={`bf-chip ${state}`} data-testid="bf-chip" data-state={state}>
      {state === "locked" ? <LockIcon decorative /> : null}
      {CHIP[state]}
    </span>
  );
}
