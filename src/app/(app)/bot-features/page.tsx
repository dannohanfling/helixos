import Link from "next/link";
import type { Metadata } from "next";
import { requireViewer } from "@/lib/auth";
import { featuresFor, unlockedCount, type FeatureView } from "@/lib/bot-features";
import { BOT_FEATURES } from "@/lib/engine/bot-features";
import { CheckIcon, Chip, FeatureIcon, LockIcon } from "@/components/bot-feature-icon";
import "./bot-features.css";

export const metadata: Metadata = { title: "Bot Features" };

/** The footer every card and row ends with: the next step, or where things stand, or what unlocks it. */
function Footer({ v, viewOnly }: { v: FeatureView; viewOnly: boolean }) {
  if (v.state === "unlocked")
    return viewOnly ? (
      <p className="bf-note">Unlocked. Only the account owner can ask for it to be switched on.</p>
    ) : (
      <Link href={`/bot-features/${v.feature.key}`} className="bf-btn" data-testid="bf-setup">
        Set it up
      </Link>
    );
  if (v.state === "requested") return <p className="bf-note">Requested · we&apos;ll let you know when it&apos;s live</p>;
  if (v.state === "on")
    return (
      <p className="bf-running">
        <CheckIcon /> Running in your bot
      </p>
    );
  return (
    <div>
      <p>
        {v.state === "coming_soon" ? "Coming soon. " : ""}Unlocks when you <b>{v.unlockLine}</b>
      </p>
      {v.progress !== null ? (
        <div className="bf-progress" role="progressbar" aria-label={`Progress to ${v.unlockLine.replace(/^reach /, "")}`} aria-valuenow={v.progress} aria-valuemin={0} aria-valuemax={100} data-testid="bf-progress">
          <span style={{ width: `${v.progress}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Bot Features (rev 618): the eight skills a member's bot can unlock, each Locked → Unlocked → Requested → On. Danno's copy and
 * design, word for word: a grid of cards on a computer, a list on a phone. A team member sees it all but can't ask.
 */
export default async function BotFeaturesPage() {
  const v = await requireViewer({ team: "allow" });
  const views = await featuresFor(v.membership);
  const unlocked = unlockedCount(views);
  const viewOnly = Boolean(v.team) || Boolean(v.switchedInto);
  return (
    <div className="bf-page" data-testid="bot-features">
      <div className="bf-inner">
        <header className="bf-head">
          <div>
            <div className="bf-eyebrow">YOUR BOT</div>
            <h1 className="bf-title bf-anton">Bot Features</h1>
            <p className="bf-sub">New skills for your bot. Each one unlocks when you hit a milestone, then we switch it on for you.</p>
          </div>
          <div>
            <div className="bf-count" data-testid="bf-count">
              {unlocked} of {BOT_FEATURES.length} unlocked
            </div>
            <div className="bf-bar" aria-hidden="true">
              {BOT_FEATURES.map((f, i) => (
                <span key={f.key} className={i < unlocked ? "on" : ""} />
              ))}
            </div>
          </div>
        </header>
        <div className="bf-grid" data-testid="bf-grid">
          {views.map((x) => (
            <article key={x.feature.key} className={`bf-card ${x.state}`} data-testid="bf-card" data-key={x.feature.key} data-state={x.state}>
              <div className="bf-top">
                <span className="bf-ring">
                  <FeatureIcon icon={x.feature.icon} />
                </span>
                <Chip state={x.state} />
              </div>
              <h2 className="bf-name bf-anton">{x.feature.name}</h2>
              <p className="bf-desc">{x.feature.description}</p>
              <div className="bf-foot">
                <Footer v={x} viewOnly={viewOnly} />
              </div>
            </article>
          ))}
        </div>
        <ul className="bf-list" data-testid="bf-list">
          {views.map((x) => {
            const open = x.state === "unlocked" || x.state === "requested" || x.state === "on";
            return (
              <li key={x.feature.key} className={`bf-row ${x.state}`} data-testid="bf-row" data-key={x.feature.key} data-state={x.state}>
                <div className="bf-row-main">
                  <span className="bf-ring">
                    <FeatureIcon icon={x.feature.icon} size={20} />
                  </span>
                  <div className="min-w-0">
                    <h2 className={`bf-name bf-anton bf-row-name`}>{x.feature.name}</h2>
                    <p className="bf-row-line">
                      {open ? (
                        x.feature.shortLine
                      ) : (
                        <>
                          {x.state === "coming_soon" ? "Coming soon. " : ""}Unlocks when you <b>{x.unlockLine}</b>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="bf-row-side">{x.state === "locked" ? <LockIcon size={18} /> : <Chip state={x.state} />}</span>
                </div>
                {x.state === "unlocked" && !viewOnly ? (
                  <Link href={`/bot-features/${x.feature.key}`} className="bf-btn" data-testid="bf-row-setup">
                    Set it up
                  </Link>
                ) : null}
                {x.state === "requested" ? <p className="bf-note">Requested · we&apos;ll let you know when it&apos;s live</p> : null}
                {x.state === "on" ? (
                  <p className="bf-running">
                    <CheckIcon /> Running in your bot
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
