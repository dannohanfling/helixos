import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { discussionsFor, stepStatus } from "@/lib/board";
import { askBoardAction, setBoardHoursAction, setBoardPresetAction, setBoardSeesBodyAction, startFreshAction, undoFreshStartAction } from "@/lib/actions/board";
import { MODE_INFO, type Mode } from "@/lib/engine/board";
import { PAGE } from "@/lib/engine/board-memory";
import { keepClassicCouncilAction } from "@/lib/actions/council";
import { councilFor } from "@/lib/board-seats";
import { forRoom } from "@/lib/engine/board";
import { BoardCouncilNote } from "@/components/board-council-note";
import { Boardroom } from "@/components/boardroom";
import { councilClipFiles } from "@/lib/board-clips";
import { sceneLookFor } from "@/lib/engine/board-view";
import { SubmitButton } from "@/components/submit-button";
import { stampDate } from "@/lib/dates";
import "./boardroom.css";

export const metadata = { title: "My Board" };

/** What a decision set up, across its follow-ups (rev 664 §6: the log says what it set up). */
const setUp = (d: { applied: unknown[] }, followUps: { applied: unknown[] }[]) => d.applied.length + followUps.reduce((n, f) => n + f.applied.length, 0);

/** My Board, the Boardroom (revs 664, 698): five advisors on a decision, grounded in the member's own HelixOS. */
export default async function MyBoardPage({ searchParams }: { searchParams: Promise<{ error?: string; council?: string; ask?: string; q?: string; show?: string; fresh?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const hours = v.membership.boardHours;
  const preset = v.role === "coach" && !v.switchedInto && v.membership.boardPreset === "edge" ? "edge" : "standard";
  const seats = forRoom(await councilFor(v));
  const canAsk = !v.switchedInto && !v.team;
  // Past discussions (H-257): the search, 20 a page with More, the ones before a fresh start grouped at the end.
  const q = (sp.q ?? "").trim().slice(0, 120);
  const show = Number(sp.show) || PAGE;
  const { rows: decisions, more, found, canUndo } = await discussionsFor(v, q, show);
  const statuses = await Promise.all(decisions.map((x) => stepStatus(v.user.id, x.decision)));
  const fresh = v.membership.boardFreshStartAt;
  const firstBefore = decisions.findIndex((x) => x.before);
  const listHref = (extra: Record<string, string>) => `/my-board?${new URLSearchParams({ ...(q ? { q } : {}), ...extra }).toString()}#discussions`;
  const exampleTick = v.role === "coach" && !v.switchedInto;
  return (
    <div className="br-page" data-testid="board-page">
      {sp.error ? (
        <p className="br-wrap" role="alert" data-testid="board-error" style={{ color: "#f5b0a0", marginBottom: 24 }}>
          {sp.error}
        </p>
      ) : null}
      {sp.council ? (
        <p className="br-wrap br-muted" role="status" data-testid="board-council-saved" style={{ marginBottom: 16 }}>
          {sp.council === "classic" ? "Kept: the classic four sit with Danno. You can choose your council any time." : "Your council is saved. Your next question sits with them; past decisions keep the seats they had."}
        </p>
      ) : null}
      {canAsk && hours && !v.membership.boardCouncil && preset === "standard" ? (
        <div className="br-wrap" data-testid="board-pick-council">
          <div className="br-head" style={{ marginBottom: 20 }}>
            <div className="br-eyebrow">NEW</div>
            <h2 className="br-question" style={{ margin: 0, fontSize: 30 }}>
              Pick your council
            </h2>
            <p className="br-muted" style={{ margin: 0 }}>
              Choose the four seats that sit with Danno on every decision: the classic four, seats of your own, or{" "}
              {v.workspace.expertSeatsLive ? "expert style advisors from the library" : "expert style advisors once your coach opens them"}. One of them turns the advice into your action steps.
            </p>
            <div className="br-askrow">
              <Link href="/my-board/council" className="br-pill" data-testid="board-pick-council-go">
                Pick your council
              </Link>
              <form action={keepClassicCouncilAction}>
                <SubmitButton className="br-tab" pendingText="Saving…" data-testid="board-keep-classic">
                  Keep the classic four
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      ) : null}
      {canAsk && !hours ? (
        <div className="br-wrap">
          <form action={setBoardHoursAction} className="br-head" id="hours">
            <div className="br-eyebrow">MY BOARD</div>
            <label htmlFor="br-hours" className="br-question">
              How many hours a week can you give your business?
            </label>
            <p className="br-muted" style={{ margin: 0 }}>
              Jordan keeps every plan inside this.
            </p>
            <div className="br-askrow">
              <input id="br-hours" name="hours" type="number" min={1} max={80} required className="br-input" style={{ flex: "0 1 160px" }} data-testid="board-hours" />
              <SubmitButton className="br-pill" pendingText="Saving…" data-testid="board-hours-save">
                Save
              </SubmitButton>
            </div>
          </form>
        </div>
      ) : (
        <Boardroom initialLook={sceneLookFor(v.membership.sceneLook, v.hour)} clips={councilClipFiles()} seats={seats} answer={null} question={(sp.ask ?? "").slice(0, 300)} used={[]} notes={[]} hours={hours} autoplay={false} action={askBoardAction} canAsk={canAsk} decisionView={false} exampleTick={exampleTick} councilHref={preset === "standard" ? "/my-board/council" : undefined} />
      )}
      {hours ? <BoardCouncilNote seats={seats} /> : null}
      {hours && preset === "standard" ? (
        // H-290: a clear way to the council page beside the chairs (members and Danno couldn't find it); a tap on a chair goes there too.
        <div className="br-wrap br-askrow" style={{ marginTop: 8, alignItems: "center" }}>
          <Link href="/my-board/council" className="br-pill" data-testid="board-council-link">
            {canAsk ? "Choose your council" : "Their council"}
          </Link>
          <span className="br-muted" style={{ fontSize: 13 }}>
            {canAsk ? "Tap a chair to change who sits in it." : "Tap a chair to see who sits in it."}
          </span>
        </div>
      ) : null}
      {!canAsk ? <p className="br-wrap br-muted">The Board answers {v.user.name.split(" ")[0]} on their own AI key, so only they can ask it. Their decisions are below.</p> : null}

      <section className="br-wrap" id="discussions" style={{ marginTop: 44 }} aria-label="Past discussions">
        <div className="br-sechead">
          <h2 className="br-h2" id="decisions">
            Past discussions
          </h2>
          <span style={{ display: "flex", gap: 4 }} aria-hidden>
            {seats.map((s) =>
              s.icon ? (
                // eslint-disable-next-line @next/next/no-img-element -- a static seat icon from public/board
                <img key={s.key} src={s.icon} alt="" width={22} height={22} />
              ) : (
                <span key={s.key}>{s.emoji}</span>
              ),
            )}
          </span>
        </div>
        {sp.fresh === "1" ? (
          <p className="br-muted" role="status" style={{ fontSize: 14, margin: "0 0 12px" }} data-testid="board-fresh-done">
            Fresh start. The Board reads only what you decide from now on; your earlier discussions are kept below.
          </p>
        ) : sp.fresh === "0" ? (
          <p className="br-muted" role="status" style={{ fontSize: 14, margin: "0 0 12px" }} data-testid="board-fresh-undone">
            Undone. The Board remembers your earlier discussions again.
          </p>
        ) : null}
        {fresh && canAsk ? (
          <div className="br-quiet" style={{ fontSize: 13, margin: "0 0 12px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }} data-testid="board-fresh-note">
            <span>Fresh start on {stampDate(fresh, v.tz)}: the Board reads only discussions since then.</span>
            {canUndo ? (
              <form action={undoFreshStartAction}>
                <SubmitButton className="br-tab" pendingText="…" data-testid="board-fresh-undo">
                  Undo
                </SubmitButton>
              </form>
            ) : null}
          </div>
        ) : null}
        <form action="/my-board" method="get" role="search" className="br-askrow" style={{ marginBottom: 12 }}>
          <input type="search" name="q" defaultValue={q} className="br-field" placeholder="Search your discussions" aria-label="Search your discussions" style={{ flex: "1 1 220px", fontSize: 14 }} data-testid="board-search" />
          <SubmitButton className="br-tab" pendingText="…" data-testid="board-search-go">
            Search
          </SubmitButton>
          {q ? (
            <Link href="/my-board#discussions" className="br-quiet" style={{ fontSize: 13 }} data-testid="board-search-clear">
              Clear
            </Link>
          ) : null}
        </form>
        {decisions.length ? (
          <ul className="br-log" style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="board-decisions">
            {decisions.map(({ decision: d, followUps, tags, before }, i) => {
              const done = statuses[i].filter((x) => x === "done").length;
              const row = (
                <li key={d.id} data-testid="board-discussion" data-before={before ? "1" : "0"}>
                  <span className="br-quiet" style={{ fontSize: 13 }}>
                    {stampDate(d.createdAt, v.tz)}
                  </span>
                  <Link href={`/my-board/${d.id}`} className="br-serif br-oneline" style={{ fontSize: 20, fontWeight: 600 }} title={d.question} data-testid="board-discussion-question">
                    {d.question}
                  </Link>
                  <span className="br-quiet" style={{ fontSize: 13 }}>
                    {MODE_INFO[(d.mode as Mode) in MODE_INFO ? (d.mode as Mode) : "board"].label}
                    {d.answer ? ` · ${done} of ${d.answer.steps.length} steps done` : " · no answer yet"}
                    {followUps.length ? ` · ${followUps.length} follow-up${followUps.length === 1 ? "" : "s"}` : ""}
                    {setUp(d, followUps) ? ` · ${setUp(d, followUps)} set up` : ""}
                  </span>
                  {tags.length ? (
                    <span style={{ display: "inline-flex", gap: 6 }} data-testid="board-discussion-tags">
                      {tags.map((t) => (
                        <span key={t} className="br-tag">
                          {t}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {d.answer ? (
                    <span className="br-muted br-oneline" style={{ flexBasis: "100%", fontSize: 14 }} title={d.answer.recommendation}>
                      {d.answer.recommendation}
                    </span>
                  ) : null}
                </li>
              );
              return i === firstBefore ? (
                <li key={`before-${d.id}`} className="br-log-group" aria-hidden={false} style={{ display: "block" }}>
                  <h3 className="br-quiet" style={{ margin: "8px 0 0", fontSize: 13, fontWeight: 400, letterSpacing: 2, textTransform: "uppercase" }} data-testid="board-before-fresh">
                    Before your fresh start ({stampDate(fresh!, v.tz)})
                  </h3>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{row}</ul>
                </li>
              ) : i > firstBefore && firstBefore >= 0 ? (
                <li key={`in-${d.id}`} style={{ display: "block", padding: 0, border: 0 }}>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{row}</ul>
                </li>
              ) : (
                row
              );
            })}
          </ul>
        ) : (
          <p className="br-muted" data-testid="board-no-discussions">
            {q ? `Nothing matches "${q}".` : "No discussions yet."}
          </p>
        )}
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginTop: 12, fontSize: 13 }}>
          {more ? (
            <Link href={listHref({ show: String(decisions.length + PAGE) })} className="br-tab" data-testid="board-more">
              More ({found - decisions.length} more)
            </Link>
          ) : null}
          {canAsk && decisions.length && !fresh ? (
            <details data-testid="board-start-fresh">
              <summary className="br-quiet" style={{ cursor: "pointer" }}>Start fresh</summary>
              <form action={startFreshAction} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                <span className="br-muted">The Board stops reading every discussion before now. They stay here, open, replay and share as before. You can undo for seven days.</span>
                <SubmitButton className="br-tab" pendingText="…" data-testid="board-start-fresh-go">
                  Yes, start fresh
                </SubmitButton>
              </form>
            </details>
          ) : null}
        </div>
      </section>

      {canAsk && hours ? (
        <details className="br-wrap" style={{ marginTop: 32, fontSize: 14 }} id="hours-edit">
          <summary className="br-muted" style={{ cursor: "pointer" }}>
            Your Board: {hours} hours a week{v.role === "coach" ? `, ${preset === "edge" ? "Edge Preset" : "the standard five"}` : ""}
          </summary>
          <form action={setBoardHoursAction} style={{ display: "flex", gap: 12, alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
            <label className="br-muted" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              Hours I can give my business each week
              <input className="br-field" name="hours" type="number" min={1} max={80} defaultValue={hours} required />
            </label>
            <SubmitButton className="br-pill" pendingText="Saving…">
              Save
            </SubmitButton>
          </form>
          {v.membership.bodyEnabled ? (
            <form action={setBoardSeesBodyAction} style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }} data-testid="board-sees-body">
              <input type="hidden" name="on" value={v.membership.boardSeesBody ? "0" : "1"} />
              <span className="br-muted">
                HumanOS: {v.membership.boardSeesBody ? "the Board reads your HumanOS summary when a decision touches your energy, health or time." : "the Board doesn't read HumanOS."}
              </span>
              <SubmitButton className="br-tab" pendingText="Saving…" data-testid="board-sees-body-toggle">
                {v.membership.boardSeesBody ? "Stop" : "Let it read my HumanOS summary"}
              </SubmitButton>
            </form>
          ) : null}
          {v.role === "coach" ? (
            <form action={setBoardPresetAction} style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }} data-testid="board-preset">
              <span className="br-muted">Your own Board:</span>
              <select className="br-field" name="preset" defaultValue={preset}>
                <option value="standard">The standard five</option>
                <option value="edge">Edge Preset (yours only, never offered to clients)</option>
              </select>
              <SubmitButton className="br-pill" pendingText="Saving…">
                Save
              </SubmitButton>
            </form>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}
