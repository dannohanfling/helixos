"use client";

/**
 * My Board, the Boardroom (rev 698): the ask, the room with its five seats, the discussion played back one advisor at a time
 * (about 3.4 s each, in speaking order), the minutes, the steps and "You decide". The playback only ever plays the answer the
 * server checked and saved: while the Board is being asked, the table shows a quiet "…" and no seat moves. Tapping a seat stops
 * the playback and spotlights that advisor; tapping it again returns to the whole Board. With reduced motion on there is no
 * pulse, bars or rise: the speaker gets the gold ring and the others dim.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MODES, MODE_INFO, SEAT_SPOTS, SPEAK_MS, takesWords, type Mode } from "@/lib/engine/board-view";
import type { BoardAnswer, Seat } from "@/lib/engine/board";
import { SubmitButton } from "@/components/submit-button";

type Props = {
  seats: Seat[];
  answer: BoardAnswer | null;
  question: string;
  used: { label: string; href: string }[];
  notes: string[];
  hours: number | null;
  autoplay: boolean;
  /** The ask: a new decision, or more on this one (parentId). */
  action: (fd: FormData) => void | Promise<void>;
  parentId?: string | null;
  canAsk: boolean;
  /** "Run the discussion" replays a decision that has an answer. */
  decisionView: boolean;
  initialMode?: Mode;
  /** "Set it up for me" under the steps, shown once the discussion ends. */
  setup?: ReactNode;
};

const DATE_FMT: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
const dayWords = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", DATE_FMT);

export function Boardroom({ seats, answer, question, used, notes, hours, autoplay, action, parentId, canAsk, decisionView, initialMode = "board", setup }: Props) {
  const spoken = useMemo(() => (answer ? seats.filter((s) => answer.advisors.some((a) => a.seat === s.key)).map((s) => s.key) : []), [seats, answer]);
  const [phase, setPhase] = useState<"idle" | "asking" | "playing" | "done">(answer ? (autoplay ? "playing" : "done") : "idle");
  const [idx, setIdx] = useState(0);
  const [spot, setSpot] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The playback: one speaker after another, then the recommendation.
  useEffect(() => {
    if (phase !== "playing") return;
    timer.current = setTimeout(() => {
      if (idx + 1 >= spoken.length) setPhase("done");
      else setIdx(idx + 1);
    }, idx >= spoken.length ? 0 : SPEAK_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [phase, idx, spoken.length]);

  const speaker = phase === "playing" ? spoken[idx] : spot;
  const card = (k: string | null) => (k && answer ? answer.advisors.find((a) => a.seat === k) ?? null : null);
  const seatOf = (k: string) => seats.find((s) => s.key === k);
  const replay = () => {
    setSpot(null);
    setIdx(0);
    setPhase("playing");
  };
  const tapSeat = (k: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (phase === "playing") setPhase("done");
    setSpot((cur) => (cur === k ? null : k));
  };
  const rowShown = (k: string) => (phase === "playing" ? spoken.indexOf(k) <= idx : phase === "done");
  const minutes = spoken;
  const totalMin = answer?.steps.reduce((a, s) => a + s.takesMinutes, 0) ?? 0;
  const showAfter = phase === "done" && !spot && answer;
  const pillReplays = decisionView && answer && !text.trim();

  return (
    <div className="br-wrap">
      <header className="br-head">
        <div className="br-eyebrow">MY BOARD</div>
        {canAsk ? (
          <form
            action={action}
            onSubmit={() => {
              setPhase("asking");
            }}
            className="br-head"
            style={{ width: "100%" }}
            data-testid="board-ask"
          >
            <label htmlFor="br-ask" className="br-question">
              {decisionView ? "Ask more about this decision" : "What are you deciding?"}
            </label>
            <div className="br-askrow">
              <input id="br-ask" name="question" className="br-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={decisionView ? "What if I only had 3 hours?" : "Run my first webinar this month, or put the time into DMs?"} required data-testid="board-question" />
              <input type="hidden" name="mode" value={mode} />
              <input type="hidden" name="focus" value={mode === "focus" ? (spot ?? "") : ""} />
              {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}
              {pillReplays ? (
                <button type="button" className="br-pill" onClick={replay} data-testid="board-replay">
                  Run the discussion
                </button>
              ) : (
                <SubmitButton className="br-pill" pendingText="The Board is thinking…" data-testid="board-submit">
                  {decisionView ? "Ask the Board" : "Convene the Board"}
                </SubmitButton>
              )}
            </div>
            <div role="group" aria-label="Mode" className="br-tabs">
              {MODES.map((m) => (
                <button key={m} type="button" className="br-tab" aria-pressed={mode === m} title={MODE_INFO[m].line} onClick={() => setMode(m)} data-testid={`board-mode-${m}`}>
                  {MODE_INFO[m].label}
                </button>
              ))}
            </div>
            {mode === "focus" ? <p className="br-quiet" style={{ margin: 0, fontSize: 13 }} data-testid="board-focus-hint">{spot ? `You'll hear from ${seatOf(spot)?.short}.` : "Tap the advisor you want to hear from."}</p> : null}
          </form>
        ) : (
          <div className="br-question">{question || "My Board"}</div>
        )}
      </header>

      <section aria-label="The boardroom" className="br-room" data-testid="board-room">
        <div className="br-table" aria-live="polite">
          {phase === "asking" ? (
            <div className="br-says-line br-quiet" data-testid="board-waiting">…</div>
          ) : speaker && card(speaker) ? (
            <div className="br-says br-rise" key={`${speaker}-${phase}`} data-testid="board-speaking">
              <div className="br-says-label">{`${seatOf(speaker)?.short.toUpperCase()} SAYS`}</div>
              <div className="br-says-line">{card(speaker)!.text}</div>
            </div>
          ) : answer && phase === "done" ? (
            <div className="br-says br-rise" data-testid="board-table-recommends">
              <div className="br-says-label">THE BOARD RECOMMENDS</div>
              <div className="br-says-line">{answer.recommendation}</div>
            </div>
          ) : (
            <div className="br-says-line br-quiet">{answer ? "" : "Say what you're deciding, and the Board will sit."}</div>
          )}
        </div>
        {seats.map((s, i) => {
          const active = speaker === s.key;
          const dim = (speaker && !active) || (answer && !spoken.includes(s.key));
          const spot0 = SEAT_SPOTS[i];
          return (
            <button
              key={s.key}
              type="button"
              className={`br-seat${active ? " br-speaking" : ""}${dim ? " br-dim" : ""}`}
              style={{ left: `${spot0.left}%`, top: `${spot0.top}%` }}
              aria-pressed={spot === s.key}
              aria-label={`${s.name}${card(s.key) ? "" : " (didn't speak on this one)"}`}
              onClick={() => tapSeat(s.key)}
              data-testid={`board-seat-${s.key}`}
            >
              <span className="br-disc">
                {s.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a static seat icon from public/board
                  <img src={s.icon} alt="" />
                ) : (
                  <span className="br-emoji" aria-hidden>
                    {s.emoji}
                  </span>
                )}
              </span>
              <span className="br-nm">{s.short}</span>
              <span className="br-rl">{s.role}</span>
              <span className="br-eq" aria-hidden>
                <i />
                <i />
                <i />
                <i />
              </span>
            </button>
          );
        })}
      </section>

      {answer ? (
        <section aria-label="The discussion" style={{ display: "flex", flexDirection: "column" }} data-testid="board-advisors">
          <div className="br-sechead">
            <h2 className="br-h2">The discussion</h2>
            {used.length ? (
              <span className="br-quiet" style={{ fontSize: 13 }} data-testid="board-used">
                The Board used:{" "}
                {used.map((u, i) => (
                  <span key={u.label}>
                    {i ? " · " : ""}
                    <Link href={u.href}>{u.label}</Link>
                  </span>
                ))}
              </span>
            ) : null}
          </div>
          {minutes.map((k) => {
            const c = card(k);
            const s = seatOf(k);
            if (!c || !s || !rowShown(k)) return null;
            return (
              <div key={k} className={`br-minute${speaker && speaker !== k ? " br-dim" : ""}`} data-testid={`board-minute-${k}`}>
                <div className="br-initial">{s.short.replace(/^The /, "").charAt(0)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="br-who">{s.role === "CHAIR" ? s.short.toUpperCase() : `${s.short.toUpperCase()} · ${s.role}`}</div>
                  <div className="br-line">{c.text}</div>
                  {c.question ? <div className="br-ask">{c.question}</div> : null}
                </div>
              </div>
            );
          })}
          {showAfter && answer.split ? (
            <div className="br-split" data-testid="board-split">
              Where the Board splits: {answer.split}
            </div>
          ) : null}
          {showAfter && answer.votes?.length ? (
            <div className="br-split">
              {answer.votes.map((v) => `${seatOf(v.seat)?.short}: ${v.option}`).join(" · ")}. This maps how each advisor leans; it isn&apos;t the truth.
            </div>
          ) : null}
          {showAfter && notes.length ? (
            <ul className="br-quiet" style={{ margin: "14px 0 0 56px", padding: 0, listStyle: "none", fontSize: 13 }} data-testid="board-notes">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {showAfter && answer.steps.length ? (
        <section aria-label="Your action steps" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div className="br-sechead">
            <h2 className="br-h2">{answer.steps.length === 1 ? "Your next move" : `Your next ${["", "", "two", "three"][answer.steps.length]} moves`}</h2>
            {hours ? (
              <span className="br-quiet" style={{ fontSize: 13 }} data-testid="board-hours-line">
                {takesWords(totalMin)} of the {hours} h you set aside this week
              </span>
            ) : null}
          </div>
          <ol className="br-steps" data-testid="board-steps">
            {answer.steps.map((s, i) => (
              <li key={i} data-testid="board-step">
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span className="br-num">{i + 1}</span>
                  {i < answer.steps.length - 1 ? <span className="br-rail" /> : null}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
                  <div className="br-do">{s.do}</div>
                  <div className="br-muted" style={{ fontSize: 14 }}>
                    {dayWords(s.by)} · {takesWords(s.takesMinutes)} · Done when {s.doneWhen}
                    {s.dependsOn ? ` · after step ${s.dependsOn}` : ""}
                  </div>
                  <div className="br-goldtext" style={{ fontSize: 14 }}>
                    First 5 minutes: {s.first5}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {showAfter && setup ? setup : null}

      {showAfter && answer.clarify?.length ? (
        <section aria-label="The Board would like to know">
          <h2 className="br-h2">The Board would like to know</h2>
          <ul className="br-muted" style={{ fontSize: 15 }}>
            {answer.clarify.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {answer && phase === "done" ? (
        <footer className="br-foot">
          <div className="br-decide" data-testid="board-you-decide">
            You decide.
          </div>
          <p className="br-quiet" style={{ margin: 0, fontSize: 13, maxWidth: 520 }}>
            {answer.youDecide && answer.youDecide !== "You decide. This is your call." ? `${answer.youDecide} ` : ""}The Board maps the options and the risks. The call is yours. The Danno Seat is guided by Danno&apos;s teaching; it is not Danno live.
          </p>
          {decisionView ? (
            <button type="button" className="br-tab" onClick={replay} data-testid="board-run-again">
              Run the discussion again
            </button>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
