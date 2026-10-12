import type { Seat } from "@/lib/engine/board";

/** Rev 756 §1: the line every council with a style-advisor seat carries. */
export const STYLE_NOTE = "Expert seats are style advisors inspired by each person's public work. They are not affiliated with or endorsed by them.";

/**
 * Under the room: who sat at the table, with each library seat's version on a past answer (rev 756 §5: an edit never rewrites
 * what an answer used), a paused or retired seat said plainly, and the style-advisor line when any seat is one.
 */
export function BoardCouncilNote({ seats, past = false }: { seats: Seat[]; past?: boolean }) {
  const styled = seats.some((s) => s.kind === "expert" || s.kind === "edge" || s.kind === "custom");
  const paused = seats.filter((s) => s.paused);
  const retired = seats.filter((s) => s.retired);
  return (
    <div className="br-wrap br-quiet" style={{ fontSize: 13, marginTop: 12, display: "grid", gap: 4 }} data-testid="board-council-note">
      {past ? (
        <p style={{ margin: 0 }} data-testid="board-sat-with">
          Sat with: {seats.map((s) => `${s.short}${s.kind && s.kind !== "chair" && s.kind !== "archetype" && s.version ? ` (version ${s.version})` : ""}`).join(" · ")}
        </p>
      ) : null}
      {paused.length ? (
        <p style={{ margin: 0 }} data-testid="board-paused">
          Paused while expert seats are off: {paused.map((s) => s.short).join(", ")} {paused.length === 1 ? "sits" : "sit"} in for your chosen {paused.length === 1 ? "seat" : "seats"}, which come back when they&apos;re on again.
        </p>
      ) : null}
      {retired.length ? (
        <p style={{ margin: 0 }} data-testid="board-retired">
          Retired by your coach: {retired.map((s) => s.short).join(", ")}. {retired.length === 1 ? "It keeps its chair" : "They keep their chairs"} until you swap {retired.length === 1 ? "it" : "them"}.
        </p>
      ) : null}
      {styled ? (
        <p style={{ margin: 0 }} data-testid="board-style-note">
          {STYLE_NOTE}
        </p>
      ) : null}
    </div>
  );
}
