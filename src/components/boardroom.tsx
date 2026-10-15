"use client";

/**
 * My Board, the Council Chamber (revs 698, 738): the ask, the photo room with its five statues, the discussion played back one advisor at a time
 * (about 3.4 s each, in speaking order), the minutes, the steps and "You decide". The playback only ever plays the answer the
 * server checked and saved: while the Board is being asked, the table shows a quiet "…" and no seat moves. Tapping a seat stops
 * the playback and spotlights that advisor; tapping it again returns to the whole Board. With reduced motion on there is no
 * lean, breathing or bars: the speaker keeps the glow and the others dim. "Golden hour / Night" is the member's own look.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CHAIRS, CHAIR_KEYS, MODES, MODE_INFO, clipFor, takesWords, turnMs, type Mode, type SceneLook } from "@/lib/engine/board-view";
import { setSceneLookAction } from "@/lib/actions/scene";
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
  /** "This is an example (don't remember it)" on the ask box (H-257): a coach's own Board only. */
  exampleTick?: boolean;
  /** "Run the discussion" replays a decision that has an answer. */
  decisionView: boolean;
  initialMode?: Mode;
  /** "Set it up for me" under the steps, shown once the discussion ends. */
  setup?: ReactNode;
  /** Each step's task, read live: a ticked task shows the step as done. */
  stepStates?: string[];
  /** The Council Chamber's look for this member (rev 738): their own choice, or night from 19:00 to 06:00. */
  initialLook?: SceneLook;
  /** The speaking clips in the repo, by file name (H-150): the page reads public/board; none means the CSS motion alone. */
  clips?: string[];
};

const LOOKS: SceneLook[] = ["day", "night"];
/** The photo behind a speaking statue's copy: WebP where the browser takes it, the JPG otherwise. */
const photoVar = (k: SceneLook) => `image-set(url("/board/council-${k}.webp") type("image/webp"), url("/board/council-${k}.jpg") type("image/jpeg"))`;
/** A plate shows the name: "Alex", "Danno", or an expert seat's "{Name} style". */
const plateName = (s: Seat) => s.short.replace(/ Advisor$/, "");

const DATE_FMT: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
const dayWords = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", DATE_FMT);

export function Boardroom({ seats, answer, question, used, notes, hours, autoplay, action, parentId, canAsk, decisionView, initialMode = "board", setup, stepStates = [], initialLook = "day", clips = [], exampleTick = false }: Props) {
  const spoken = useMemo(() => (answer ? seats.filter((s) => answer.advisors.some((a) => a.seat === s.key)).map((s) => s.key) : []), [seats, answer]);
  const [phase, setPhase] = useState<"idle" | "asking" | "playing" | "done">(answer ? (autoplay ? "playing" : "done") : "idle");
  const [idx, setIdx] = useState(0);
  const [spot, setSpot] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [look, setLook] = useState<SceneLook>(initialLook);
  const [still, setStill] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setStill(q.matches);
    set();
    q.addEventListener("change", set);
    return () => q.removeEventListener("change", set);
  }, []);
  // The member's own look, remembered for the Council Chamber, the Colosseum and the Aqueduct.
  const chooseLook = (k: SceneLook) => {
    setLook(k);
    if (canAsk) void setSceneLookAction(k);
  };

  // The playback: one speaker after another, then the recommendation. Each turn lasts turnMs of its quote (H-245: 10 to 15 s);
  // a held turn (a tap on the quote) stops the clock and goes on from where it was on the next tap.
  const [held, setHeld] = useState(false);
  const leftRef = useRef<number | null>(null);
  const startedRef = useRef<number>(0);
  const quoteOf = (k: string | undefined) => (k && answer ? (answer.advisors.find((a) => a.seat === k)?.text ?? "") : "");
  const turnLength = phase === "playing" ? turnMs(quoteOf(spoken[idx])) : 0;
  useEffect(() => {
    if (phase !== "playing" || held) return;
    const wait = idx >= spoken.length ? 0 : (leftRef.current ?? turnLength);
    leftRef.current = null;
    startedRef.current = Date.now();
    timer.current = setTimeout(() => {
      if (idx + 1 >= spoken.length) setPhase("done");
      else setIdx(idx + 1);
    }, wait);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [phase, idx, spoken.length, held, turnLength]);
  const toggleHold = () => {
    if (phase !== "playing") return;
    if (!held) {
      if (timer.current) clearTimeout(timer.current);
      leftRef.current = Math.max(500, turnLength - (Date.now() - startedRef.current));
      setHeld(true);
    } else setHeld(false);
  };

  const speaker = phase === "playing" ? spoken[idx] : spot;
  const card = (k: string | null) => (k && answer ? answer.advisors.find((a) => a.seat === k) ?? null : null);
  const seatOf = (k: string) => seats.find((s) => s.key === k);
  // "▶ Play again" (H-245): the same session from the first speaker, from the answer already saved; no request leaves the page.
  const replay = () => {
    setSpot(null);
    setHeld(false);
    leftRef.current = null;
    setIdx(0);
    setPhase("playing");
  };
  const tapSeat = (k: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (phase === "playing") setPhase("done");
    setSpot((cur) => (cur === k ? null : k));
  };
  // The table's words: "…" while the Board is asked, the speaker's line, or the recommendation. On a phone they sit under the room.
  const words = (ids: boolean) =>
    phase === "asking" ? (
      <div className="br-says-line br-quiet" data-testid={ids ? "board-waiting" : undefined}>
        …
      </div>
    ) : speaker && card(speaker) ? (
      <div
        className={`br-says br-rise${held ? " br-held" : ""}`}
        key={`${speaker}-${phase}`}
        data-testid={ids ? "board-speaking" : undefined}
        data-turn-ms={phase === "playing" ? turnLength : undefined}
        data-held={held ? "1" : "0"}
        role={phase === "playing" ? "button" : undefined}
        tabIndex={phase === "playing" ? 0 : undefined}
        aria-label={phase === "playing" ? (held ? "Paused. Press to go on" : "Press to hold this turn") : undefined}
        onClick={phase === "playing" ? toggleHold : undefined}
        onKeyDown={phase === "playing" ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleHold(); } } : undefined}
      >
        <div className="br-says-label">
          {`${seatOf(speaker)?.short.toUpperCase()} SAYS`}
          {held ? <span className="br-paused" data-testid={ids ? "board-held" : undefined}>paused</span> : null}
        </div>
        <div className="br-says-line">{card(speaker)!.text}</div>
      </div>
    ) : answer && phase === "done" ? (
      <div className="br-says br-rise" data-testid={ids ? "board-table-recommends" : undefined}>
        <div className="br-says-label">THE BOARD RECOMMENDS</div>
        <div className="br-says-line">{answer.recommendation}</div>
      </div>
    ) : (
      <div className="br-says-line br-quiet">{answer ? "" : "Say what you're deciding, and the Board will sit."}</div>
    );
  // A speaking clip plays for the speaker's turn when one is in the repo, never with reduced motion; only the next one preloads.
  // A clip belongs to the chair, whoever sits in it (rev 756).
  const chairOf = (k: string) => CHAIR_KEYS[seats.findIndex((s) => s.key === k)] ?? null;
  const clipOf = (k: string | undefined | null) => (k && !still ? clipFor(clips, look, chairOf(k)) : null);
  const clip = clipOf(speaker);
  const nextClip = phase === "playing" ? clipOf(spoken[idx + 1]) : null;
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
                <button type="button" className="br-pill" onClick={replay} aria-label="Play the discussion again" data-testid="board-replay">
                  ▶ Play again
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
            {exampleTick && !decisionView ? (
              <label className="br-quiet" style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" name="example" value="1" data-testid="board-example" /> This is an example (don&rsquo;t remember it)
              </label>
            ) : null}
          </form>
        ) : (
          <div className="br-question">{question || "My Board"}</div>
        )}
      </header>

      <section aria-label="The boardroom" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className={`br-room br-${look}`} data-testid="board-room" data-look={look} style={{ ["--br-photo" as string]: photoVar(look) }}>
          {LOOKS.map((k) => (
            <picture key={k}>
              <source type="image/webp" srcSet={`/board/council-${k}.webp`} />
              <img className="br-photo" src={`/board/council-${k}.jpg`} alt="" hidden={k !== look} loading={k === look ? "eager" : "lazy"} decoding="async" data-testid={`board-photo-${k}`} />
            </picture>
          ))}
          {/* The speaker's clip over the still, the still as its poster (frame 0 and the last frame match it, so no jump either way);
              WebM first, the MP4 for the rest; muted and inline, looping for the turn. The next speaker's clip warms in a hidden
              video (browsers ignore a preload link for video). */}
          {clip ? (
            <video key={clip.mp4} className="br-photo br-clip" poster={`/board/council-${look}.jpg`} muted autoPlay loop playsInline aria-hidden data-testid="board-clip" data-chair={chairOf(speaker!)} data-name={clip.name}>
              {clip.webm ? <source src={clip.webm} type="video/webm" /> : null}
              <source src={clip.mp4} type="video/mp4" />
            </video>
          ) : null}
          {nextClip ? (
            <video key={`next-${nextClip.mp4}`} className="br-clip-next" preload="auto" muted playsInline aria-hidden tabIndex={-1} data-testid="board-clip-next" data-name={nextClip.name}>
              {nextClip.webm ? <source src={nextClip.webm} type="video/webm" /> : null}
              <source src={nextClip.mp4} type="video/mp4" />
            </video>
          ) : null}
          {seats.map((s, i) => {
            const g = CHAIRS[i];
            const active = speaker === s.key;
            const dim = Boolean((speaker && !active) || (answer && !spoken.includes(s.key)));
            return (
              <button
                key={s.key}
                type="button"
                className={`br-seat${active ? " br-speaking" : ""}${active && clip ? " br-clipped" : ""}${dim ? " br-dim" : ""}`}
                style={{ left: `${+(g.l + g.w / 2).toFixed(3)}%`, top: `${+(g.t + g.h / 2).toFixed(3)}%`, width: `${g.w}%`, height: `${g.h}%` }}
                aria-pressed={spot === s.key}
                aria-label={`${s.short}, ${s.role.toLowerCase()}${card(s.key) || !answer ? "" : " (didn't speak on this one)"}`}
                onClick={() => tapSeat(s.key)}
                data-testid={`board-seat-${s.key}`}
              >
                <span className="br-shade" />
                <span className="br-live" style={{ backgroundSize: `${(10000 / g.w).toFixed(2)}% ${(10000 / g.h).toFixed(2)}%`, backgroundPosition: `${((g.l / (100 - g.w)) * 100).toFixed(2)}% ${((g.t / (100 - g.h)) * 100).toFixed(2)}%` }} />
                <span className="br-glow" />
                <span className="br-plate" style={{ left: `${(((g.px - g.l) / g.w) * 100).toFixed(1)}%`, top: `${(((g.py - g.t) / g.h) * 100).toFixed(1)}%` }} data-testid={`board-plate-${s.key}`}>
                  <span className="br-nm">{plateName(s)}</span>
                  <span className="br-rl">{s.role}</span>
                  <span className="br-eq" aria-hidden>
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
              </button>
            );
          })}
          <div className="br-table" aria-live="polite">
            {words(true)}
          </div>
        </div>
        <div className="br-caption" data-testid="board-caption">
          {words(false)}
        </div>
        <div role="group" aria-label="Time of day" className="br-looks">
          {LOOKS.map((k) => (
            <button key={k} type="button" className="br-look" aria-pressed={look === k} onClick={() => chooseLook(k)} data-testid={`board-look-${k}`}>
              {k === "day" ? "Golden hour" : "Night"}
            </button>
          ))}
        </div>
      </section>

      {seats.some((s) => s.role === "STYLE ADVISOR") ? (
        <p className="br-quiet" style={{ margin: "-24px 0 0", textAlign: "center", fontSize: 13 }} data-testid="board-edge-note">
          Edge Preset: {seats.filter((s) => s.role === "STYLE ADVISOR").map((s) => s.short.replace(/ (Advisor|style)$/, "")).join(", ")} sit as style advisors, in their manner only. They aren&apos;t the people and never speak as them. Yours alone.
        </p>
      ) : null}

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
                  <div className="br-do">
                    {s.do}
                    {stepStates[i] === "done" ? (
                      <span className="br-goldtext" style={{ fontSize: 13, fontWeight: 500 }} data-testid="board-step-done">
                        {" "}
                        · Done
                      </span>
                    ) : null}
                  </div>
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
            {answer.youDecide && answer.youDecide !== "You decide. This is your call." ? `${answer.youDecide} ` : ""}The Board maps the options and the risks. The call is yours. Danno here is guided by Danno&apos;s teaching; it is not Danno live.
          </p>
          {decisionView ? (
            <button type="button" className="br-tab" onClick={replay} aria-label="Play the discussion again" data-testid="board-run-again">
              ▶ Play again
            </button>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
