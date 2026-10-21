import type { PageMember, PageModel } from "@/lib/engine/leaderboard";
import { BELOW_FIRST_TIER, fmt } from "@/lib/engine/leaderboard";
import { LocalTime } from "@/components/local-time";

/**
 * The Kindness Koin leaderboard (H-28), rendered on the server from the page model: the 9 Oct design's markup, class for
 * class, with the numbers in the first paint. Only what the model holds reaches the HTML: "First L.", lifetime, available
 * and tier per member, and the client's own copy, tiers, rewards and pass link. Search, sort and "Show everyone" are the
 * design's own behaviour, kept as a small script over the rows already on the page; nothing is fetched by the browser.
 */
const SHOW = 25;

function nextLine(m: PageMember, u: string) {
  if (!m.next) return <div className="l-next">Top tier reached</div>;
  return (
    <>
      <div className="l-bar">
        <i style={{ width: `${m.pct}%` }} />
      </div>
      <div className="l-next">
        {fmt(m.toNext)} {u} to {m.next.name}
      </div>
    </>
  );
}

export function Board({ model, unit }: { model: PageModel; unit?: string }) {
  const c = model.config;
  const u = unit ?? c.unit;
  const headline = c.headlineEm && c.headline.includes(c.headlineEm) ? c.headline.split(c.headlineEm) : null;
  return (
    <div id="ckl-root" data-source={model.source.kind}>
      <div className="l-inner">
        {c.eyebrow ? <div className="l-eyebrow">{c.eyebrow}</div> : null}
        <h1>
          {headline ? (
            <>
              {headline[0]}
              <em>{c.headlineEm}</em>
              {headline.slice(1).join(c.headlineEm)}
            </>
          ) : (
            c.headline
          )}
        </h1>
        {c.quote ? <p className="l-quote">{c.quote}</p> : null}
        {c.intro ? <p className="l-sub">{c.intro}</p> : null}
        {c.passUrl ? (
          <a className="l-join" href={c.passUrl} rel="noreferrer">
            Want to be on the leaderboard? <b>Add your pass here</b> <span aria-hidden="true">→</span>
          </a>
        ) : null}
        <p className="l-updated" id="ckl-updated">
          {model.updatedAt ? (
            <>
              Live · updated <LocalTime iso={model.updatedAt} fallback={model.updatedLabel.replace(/^Live · updated /, "")} />
            </>
          ) : (
            model.updatedLabel
          )}
        </p>
        <div id="ckl-sample">{model.source.kind === "sample" ? <div className="l-sample">SAMPLE DATA · REPLACE WITH THE EXPORT</div> : null}</div>

        <div className="l-layout">
          <aside className="l-rewards" aria-label="Rewards you can earn">
            <div className="l-rw-head">Rewards you can earn</div>
            <p className="l-rw-sub">
              Spend your available {u}. Your lifetime {u} never goes down.
            </p>
            <div id="ckl-rw-sample">{c.rewardsSample ? <span className="l-rw-tag">SAMPLE COSTS · TO CONFIRM</span> : null}</div>
            <ol className="l-rw-list" id="ckl-rewards-list">
              {model.rewards.map((r, i) => (
                <li key={i}>
                  <span className="l-rw-name">{r.name}</span>
                  <span className="l-rw-cost">
                    {r.cost == null ? "—" : fmt(r.cost)}
                    <small>{u}</small>
                  </span>
                  {r.desc ? <span className="l-rw-desc">{r.desc}</span> : null}
                  {r.canRedeem != null ? <span className="l-rw-can">{r.canRedeem === 0 ? "Be the first to unlock this" : r.canRedeem === 1 ? "1 member can redeem this now" : `${fmt(r.canRedeem)} members can redeem this now`}</span> : null}
                </li>
              ))}
            </ol>
            <div className="l-rw-head l-tiers-head">Tiers on lifetime {u}</div>
            <div id="ckl-tiers-sample">{c.tiersSample ? <span className="l-rw-tag">SAMPLE TIERS · TO CONFIRM</span> : null}</div>
            <ol className="l-rw-list" id="ckl-tiers-list" data-testid="lb-tiers-list">
              {c.tiers.map((t, i) => (
                <li key={i}>
                  <span className="l-rw-name">{t.name}</span>
                  <span className="l-rw-cost">
                    {fmt(t.min)}
                    <small>{u}</small>
                  </span>
                  {t.reward ? <span className="l-rw-desc">{t.reward}</span> : null}
                </li>
              ))}
            </ol>
            {c.passUrl ? (
              <a className="l-rw-join" href={c.passUrl} rel="noreferrer">
                Start earning: get your free pass
              </a>
            ) : null}
          </aside>
          <main className="l-board">
            <div className="l-stats">
              <div className="l-stat">
                <b id="ckl-s-members">{fmt(model.stats.members)}</b>
                <span>Members</span>
              </div>
              <div className="l-stat">
                <b id="ckl-s-total">{fmt(model.stats.lifetime)}</b>
                <span>{u} earned together</span>
              </div>
              <div className="l-stat">
                <b id="ckl-s-avail">{model.stats.available == null ? "—" : fmt(model.stats.available)}</b>
                <span>{u} ready to redeem</span>
              </div>
            </div>

            <div className="l-podium" id="ckl-podium">
              {[1, 0, 2].map((i) => {
                const m = model.podium[i];
                if (!m) return null;
                return (
                  <div className={`l-pod p${i + 1}`} key={i}>
                    <div className="l-medal">{m.rank}</div>
                    <div className="l-pod-name">{m.name}</div>
                    <div className="l-pod-kk">
                      {fmt(m.lifetime)}
                      <small>{u}</small>
                    </div>
                    <div className="l-pod-meta">
                      {m.tier || BELOW_FIRST_TIER}
                      {model.hasAvailable ? ` · ${fmt(m.available)} available` : ""}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="l-tools">
              <input className="l-search" id="ckl-search" type="search" placeholder="Find your name" aria-label="Find your name" />
              <div className="l-sort" role="group" aria-label="Sort by">
                <button type="button" className="on" data-sort="life">
                  Lifetime {u}
                </button>
                <button type="button" data-sort="av">
                  Available {u}
                </button>
              </div>
            </div>

            <div className="l-list">
              <div className="l-head">
                <div>#</div>
                <div>Member</div>
                <div>Tier</div>
                <div className="r">Lifetime</div>
                <div className="r">Available</div>
              </div>
              <div id="ckl-rows" data-show={SHOW}>
                {model.members.length ? (
                  model.members.map((m, i) => (
                    <div className={`l-row${m.rank <= 3 ? " top" : ""}`} key={i} data-name={m.name.toLowerCase()} data-life={m.lifetime} data-av={m.available ?? 0} data-rank={m.rank} hidden={i >= SHOW}>
                      <div className="c-rank l-rank">{m.rank}</div>
                      <div className="c-name l-name">{m.name}</div>
                      <div className="c-tier">
                        <span className="l-tier">{m.tier || BELOW_FIRST_TIER}</span>
                        {nextLine(m, u)}
                      </div>
                      <div className="c-life r">
                        <span className="l-lab">Lifetime</span>
                        <span className="l-num">{fmt(m.lifetime)}</span>
                      </div>
                      <div className="c-av r">
                        <span className="l-lab">Available</span>
                        <span className="l-num av">{model.hasAvailable ? fmt(m.available) : "—"}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="l-empty">Nobody on the board yet.</div>
                )}
                <div className="l-empty" id="ckl-none" hidden>
                  No member found by that name. Names show as first name and last initial.
                </div>
              </div>
              <button type="button" className="l-more" id="ckl-more" hidden={model.members.length <= SHOW}>
                Show everyone ({fmt(model.members.length)})
              </button>
            </div>
          </main>
        </div>

        <div className="l-note">
          <b>Lifetime {u}</b> is your enduring record. Redeeming never takes it away, so your tier only ever climbs.
          <br />
          <b>Available {u}</b> is what you can exchange for rewards today.
          <br />
          <b>Next tier</b> shows how much more lifetime {u} reaches the next tier.
        </div>

        {c.passUrl ? (
          <a className="l-cta" href={c.passUrl} rel="noreferrer">
            GET MY FREE PASS
          </a>
        ) : null}

        {c.footer ? <div className="l-foot">{c.footer}</div> : null}
      </div>
      <script dangerouslySetInnerHTML={{ __html: BEHAVIOUR }} />
    </div>
  );
}

/** The design's search, sort and "Show everyone", over the rows the server rendered. No fetch, no data beyond the page. */
const BEHAVIOUR = `(function(){
  var root=document.getElementById('ckl-root'); if(!root) return;
  var box=document.getElementById('ckl-rows'), more=document.getElementById('ckl-more'), none=document.getElementById('ckl-none');
  var SHOW=Number(box.getAttribute('data-show'))||25;
  var rows=Array.prototype.slice.call(box.querySelectorAll('.l-row'));
  var sortKey='life', q='', all=false;
  function render(){
    var list=rows.slice();
    if(sortKey==='av'){ list.sort(function(a,b){return (Number(b.getAttribute('data-av'))-Number(a.getAttribute('data-av')))||(Number(b.getAttribute('data-life'))-Number(a.getAttribute('data-life')));});
      var r=0,p=null; list.forEach(function(el,i){var av=Number(el.getAttribute('data-av')); if(av!==p){r=i+1;p=av;} el.setAttribute('data-shown',String(r));}); }
    else { list.sort(function(a,b){return Number(a.getAttribute('data-rank'))-Number(b.getAttribute('data-rank'));}); list.forEach(function(el){el.setAttribute('data-shown',el.getAttribute('data-rank'));}); }
    list.forEach(function(el){box.insertBefore(el,none);});
    var shown=0;
    list.forEach(function(el){
      var hit=!q||el.getAttribute('data-name').indexOf(q)>-1;
      var show=hit&&(all||q||shown<SHOW);
      if(hit) shown++;
      el.hidden=!show;
      el.querySelector('.l-rank').textContent=el.getAttribute('data-shown');
    });
    none.hidden=shown>0||rows.length===0;
    more.hidden=all||!!q||rows.length<=SHOW;
  }
  var search=document.getElementById('ckl-search');
  if(search) search.addEventListener('input',function(e){q=e.target.value.trim().toLowerCase();render();});
  root.querySelectorAll('.l-sort button').forEach(function(b){b.addEventListener('click',function(){
    root.querySelectorAll('.l-sort button').forEach(function(x){x.classList.remove('on');});
    b.classList.add('on'); sortKey=b.getAttribute('data-sort'); render();});});
  if(more) more.addEventListener('click',function(){all=true;render();});
})();`;
