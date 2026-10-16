"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toggleWantAction } from "@/lib/actions/horizon";
import { HORIZON_CHIPS, HORIZON_LISTS, inArea, type HorizonArea, type HorizonStatus } from "@/lib/engine/horizon";
import "./horizon-board.css";

export type BoardItem = { id: string; title: string; line: string; area: HorizonArea; status: HorizonStatus; fromFeedback: boolean; wanted: boolean; votable: boolean };

/**
 * On the horizon, the member's view (H-385, plan H-387 §3 to §5): four lists side by side on a desktop with the area chips
 * above; four tabs on a phone, Next up open first. Each card: the area, the title, one line, "You asked for this" when it
 * came from feedback, and Want this on the two lists members vote on (44 px, aria-pressed, "You want this" in the coin's
 * gold). A member sees only their own vote; nobody's count. The ember dot on Being built now stills under reduced motion.
 */
export function HorizonBoard({ items, canVote, highlight }: { items: BoardItem[]; canVote: boolean; highlight?: string | null }) {
  const params = useSearchParams();
  const router = useRouter();
  const [chip, setChip] = useState<string>("All");
  const tabParam = params.get("tab");
  const tab: HorizonStatus = HORIZON_LISTS.some((l) => l.key === tabParam) ? (tabParam as HorizonStatus) : "next";
  const shown = items.filter((i) => inArea(i, chip));
  const setTab = (k: HorizonStatus) => router.replace(`/whats-new/horizon?tab=${k}`, { scroll: false });
  return (
    <div className="hz" data-testid="horizon-board">
      <div className="hz-chips" role="group" aria-label="Area" data-testid="horizon-chips">
        {HORIZON_CHIPS.map((c) => (
          <button key={c} type="button" className="hz-chip" aria-pressed={chip === c} onClick={() => setChip(c)} data-testid="horizon-chip" data-chip={c}>
            {c}
          </button>
        ))}
      </div>
      {/* Phone: tabs. Desktop: the four lists side by side (CSS decides; both are in the tree so one markup serves both). */}
      <div className="hz-tabs" role="tablist" aria-label="Lists" data-testid="horizon-tabs">
        {HORIZON_LISTS.map((l) => (
          <button key={l.key} type="button" role="tab" aria-selected={tab === l.key} className="hz-tab" onClick={() => setTab(l.key)} data-testid="horizon-tab" data-list={l.key}>
            {l.tab}
            <span className="hz-tab-n">{shown.filter((i) => i.status === l.key).length}</span>
          </button>
        ))}
      </div>
      <div className="hz-lists">
        {HORIZON_LISTS.map((l) => {
          const rows = shown.filter((i) => i.status === l.key);
          return (
            <section key={l.key} className="hz-list" data-list={l.key} data-active={tab === l.key} aria-label={l.name} data-testid="horizon-list">
              <header className="hz-list-head">
                <h2 className="hz-list-name">
                  {l.key === "building" ? <span className="hz-ember" aria-hidden /> : null}
                  {l.name}
                </h2>
                <p className="hz-list-sub">{l.sub}</p>
              </header>
              {rows.length ? (
                <ul className="hz-cards">
                  {rows.map((i) => (
                    <Card key={i.id} item={i} canVote={canVote && l.votable} highlighted={highlight === i.id} />
                  ))}
                </ul>
              ) : (
                <p className="hz-empty" data-testid="horizon-empty">
                  {chip === "All" ? "Nothing here right now." : `Nothing in ${chip} here right now.`}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Card({ item, canVote, highlighted }: { item: BoardItem; canVote: boolean; highlighted: boolean }) {
  const [pending, start] = useTransition();
  const [wanted, setWanted] = useOptimistic(item.wanted);
  const [error, setError] = useState<string | null>(null);
  const toggle = () =>
    start(async () => {
      setWanted(!wanted);
      const out = await toggleWantAction(item.id);
      if ("error" in out) setError(out.error);
    });
  return (
    <li id={`h-${item.id}`} className={`hz-card${highlighted ? " hz-card-hl" : ""}`} data-testid="horizon-item" data-item={item.id} data-area={item.area} data-wanted={wanted ? "1" : "0"}>
      <div className="hz-card-top">
        <span className="hz-area" data-testid="horizon-area">{item.area}</span>
        {item.fromFeedback ? <span className="hz-asked" data-testid="horizon-asked">You asked for this</span> : null}
      </div>
      <h3 className="hz-title">{item.title}</h3>
      <p className="hz-line">{item.line}</p>
      {canVote ? (
        <button type="button" className={`hz-want${wanted ? " hz-want-on" : ""}`} aria-pressed={wanted} disabled={pending} onClick={toggle} data-testid="horizon-want">
          {wanted ? "You want this" : "Want this"}
        </button>
      ) : null}
      {error ? <p className="hz-error" role="alert">{error}</p> : null}
    </li>
  );
}
