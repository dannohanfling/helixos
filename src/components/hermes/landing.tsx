import Image from "next/image";
import type { MfPillar, MfPitch } from "@/lib/engine/magic-funnel";
import type { CallContext, Prefill, Proof } from "@/lib/hermes/data";
import { AFTER, BEFORE, FOOTER_META, FOR_YOU, HOST, LETTER, MARQUEE, NOT_FOR_YOU, PART_PHOTOS, PARTS, PHOTO, WHAT, WHY, WHY_LISTEN, faq, ps, whenCard } from "@/lib/hermes/copy";
import { Countdown } from "@/components/hermes/countdown";
import { SeatForm } from "@/components/hermes/seat-form";
import { Pixel } from "@/components/hermes/pixel";

type Photo = { src: string; width: number; height: number; alt: string };
const Img = ({ p, className, sizes, priority }: { p: Photo; className?: string; sizes: string; priority?: boolean }) => <Image src={p.src} width={p.width} height={p.height} alt={p.alt} className={className} sizes={sizes} priority={priority} />;

/** A "Save my seat" button to the form, with the date under it as on the canvas. */
function SeatLink({ label, sub, inline }: { label: string; sub: string; inline?: boolean }) {
  return (
    <a href="#seat" className={`hm-cta${inline ? " hm-cta-inline" : ""}`}>
      <span className="hm-cta-label">{label} →</span>
      <span className="hm-cta-sub">{sub}</span>
    </a>
  );
}

type Part = { key: string; title: string; shift: string; forYou: string | null; familiar: string | null; photo: Photo };

/**
 * The three shifts: the webinar's own pillars, in the order the engine chose for this person (the one that fixes their pain
 * first), each with its "for you" line; the canvas's three parts when the setup has none. Photos stay with their pillar.
 */
function partsFor(pitch: MfPitch, pillars: MfPillar[], personal: boolean): Part[] {
  if (!pillars.length) return PARTS.map((p, i) => ({ key: `part-${i}`, title: p.title, shift: p.shift, forYou: null, familiar: p.familiar, photo: PART_PHOTOS[i] }));
  const byId = new Map(pillars.map((p, i) => [p.id, { p, i }]));
  const order = [...pitch.pillars.order.filter((id) => byId.has(id)), ...pillars.map((p) => p.id).filter((id) => !pitch.pillars.order.includes(id))];
  return [...new Set(order)].map((id) => {
    const { p, i } = byId.get(id)!;
    const line = pitch.pillars.lines[id]?.trim() ?? "";
    return { key: id, title: p.title, shift: p.copy, forYou: personal && line && line !== p.copy.trim() ? line : null, familiar: null, photo: PART_PHOTOS[i % PART_PHOTOS.length] };
  });
}

export type LandingProps = {
  ctx: CallContext;
  pitch: MfPitch;
  /** The engine's personal copy is on this page (not the default copy). */
  personal: boolean;
  firstName: string;
  prefill: Prefill | null;
  proofs: Proof[];
  code: string | null;
  formError: string | null;
  now: number;
  /** The coach's preview: personal sections outlined, the form doesn't post. */
  preview?: boolean;
};

export function Landing({ ctx, pitch, personal, firstName, prefill, proofs, code, formError, now, preview }: LandingProps) {
  const w = ctx.when;
  const cta = pitch.hero.cta_label?.trim() || (firstName ? `Save my seat, ${firstName}` : "Save my seat");
  const parts = partsFor(pitch, ctx.setup.pillars, personal);
  const whyYou = pitch.why_you.map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const example = pitch.example.text.trim() ? pitch.example : null;
  const objection = pitch.objection.objection.trim() && pitch.objection.answer.trim() ? pitch.objection : null;
  const mark = (on: boolean) => (on ? " hm-personal" : "");
  const pixel = !code && ctx.pixelId && !preview ? ctx.pixelId : null;

  return (
    <div className={`hm-root${preview ? " hm-marks" : ""}`} data-testid="hm-landing" data-page={code ? "personal" : "cold"} data-copy={personal ? "personal" : "default"}>
      {pixel ? <Pixel id={pixel} event="PageView" /> : null}
      <div className="hm-bar">
        <div className="hm-wrap">
          <span className="hm-bar-text">
            <span aria-hidden="true">● </span>Live · {ctx.title} · {w.line}
          </span>
          <a href="#seat" className="hm-bar-btn">
            Save my seat
          </a>
        </div>
      </div>

      <section className="hm-hero">
        <div className="hm-wrap">
          <div className="hm-hero-head">
            <div className="hm-brand">
              <Img p={PHOTO.logo} sizes="46px" priority />
              <span className="hm-serif">Inner Circle call</span>
            </div>
            {firstName && personal ? <div className={`hm-eyebrow${mark(true)}`}>{firstName}, this one is for you</div> : null}
            <h1 className={`hm-h1 hm-serif${mark(personal)}`} data-testid="hm-header">
              {pitch.hero.header}
            </h1>
          </div>
          <div className="hm-hero-row">
            <figure className="hm-hero-photo">
              <Img p={PHOTO.hero} sizes="(max-width: 520px) 100vw, 470px" priority />
              <figcaption className="hm-serif">
                &ldquo;Connection over competition. Every time.&rdquo;
                <small>{HOST.toUpperCase()}</small>
              </figcaption>
            </figure>
            <div className="hm-card">
              <div className="hm-card-title hm-serif">
                Join the <span className="hm-gold">Inner Circle</span> call
              </div>
              <div className="hm-rule" aria-hidden="true" />
              <p className={mark(personal)} data-testid="hm-subheader">
                {pitch.hero.subheader}
              </p>
              <div className="hm-dateline" data-testid="hm-when">
                <span>{w.day}</span>
                <span className="hm-gold" aria-hidden="true">
                  ·
                </span>
                <span>
                  {w.time}
                  {w.timeEt ? ` · ${w.timeEt}` : ""}
                </span>
              </div>
              <Countdown startsAt={w.startsAt} initialNow={now} />
              <a href="#seat" className={`hm-cta${mark(personal)}`} data-testid="hm-hero-cta">
                <span className="hm-cta-label">{cta} →</span>
                <span className="hm-cta-sub">{w.banner} · LIVE ONLINE</span>
              </a>
              <div className="hm-ticks">
                <span>✓ No ad budget needed</span>
                <span>✓ No tech skills needed</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="hm-strip" aria-hidden="true">
        <div className="hm-track hm-serif">
          {[...MARQUEE, ...MARQUEE].map((t, i) => (
            <span key={i} style={{ display: "contents" }}>
              <span>{t}</span>
              <span>✦</span>
            </span>
          ))}
        </div>
      </div>

      {whyYou.length ? (
        <section className="hm-section hm-glow" data-testid="hm-why-you">
          <div className="hm-wrap hm-narrow hm-stack">
            <div className="hm-heading">
              <span className="hm-kicker">{firstName && personal ? `For you, ${firstName}` : "Is this for you?"}</span>
              <h2 className="hm-h2 hm-serif">Why this call fits you</h2>
              <div className="hm-rule" aria-hidden="true" />
            </div>
            <div className={`hm-grid hm-grid-3${mark(personal)}`}>
              {whyYou.map((b, i) => (
                <div key={i} className="hm-box hm-box-gold hm-why">
                  <span className="hm-why-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="hm-section hm-paper hm-letter">
        <div className="hm-wrap hm-letter-wrap hm-stack">
          <div className="hm-letter-top">
            <div className="hm-letter-col">
              <div className="hm-desk">
                <Img p={PHOTO.headshot} sizes="64px" />
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span className="hm-desk-small">FROM THE DESK OF</span>
                  <span className="hm-desk-name hm-serif">{HOST}</span>
                  <span className="hm-desk-to">{LETTER.to}</span>
                </div>
              </div>
              <p>
                When I started, a dozen people were teaching exactly what I wanted to teach. <strong>They had bigger teams, bigger budgets and six, seven, eight-figure businesses.</strong> I hadn&apos;t made my first thousand.
              </p>
              <p>
                For a long time, the conversation in my head was simple: <strong>why would anyone trust me?</strong>
              </p>
              <p>I tried it all. Funnels. Email sequences. Ads. Cold DMs. Each one was supposed to be the answer. Each one fell flat. Then I stopped copying other people&apos;s blueprints and started building around how my people actually move and talk.</p>
            </div>
            <Img p={PHOTO.letter} className="hm-letter-photo" sizes="(max-width: 460px) 100vw, 420px" />
          </div>
          <blockquote className="hm-quote hm-serif">
            &ldquo;{LETTER.quote.before}
            <u>{LETTER.quote.em}</u>
            {LETTER.quote.after}&rdquo;
          </blockquote>
          <p>
            I didn&apos;t build Evolve Omega for chatbots, and I didn&apos;t build it for AI. <strong>I built it for community.</strong> I watched too many people run their groups and businesses harshly, and their people deserved better. Everything I teach comes back to one idea: go where your people are and talk to them like people.
          </p>
          <p>{LETTER.close(w)}</p>
          <p className="hm-sign hm-serif">Danno</p>
          <SeatLink label={cta} sub={`${w.banner} · LIVE ONLINE`} inline />
        </div>
      </section>

      <section className="hm-section hm-dark">
        <div className="hm-wrap hm-narrow hm-grid">
          <div className="hm-box">
            <div className="hm-box-title hm-serif">
              This is <span className="hm-mark-no">not</span> for you if…
            </div>
            <ul className="hm-list">
              {NOT_FOR_YOU.map((t) => (
                <li key={t}>
                  <span aria-hidden="true">✗</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="hm-box hm-box-gold">
            <div className="hm-box-title hm-serif">
              This <span className="hm-gold">is</span> for you if…
            </div>
            <ul className="hm-list">
              {FOR_YOU.map((t) => (
                <li key={t}>
                  <span className="hm-mark-yes" aria-hidden="true">
                    ✓
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="hm-section hm-paper">
        <div className="hm-wrap hm-narrow hm-stack">
          <div className="hm-heading">
            <span className="hm-kicker">What we&apos;ll work on, live</span>
            <h2 className="hm-h2 hm-serif">Three shifts in one call</h2>
            <div className="hm-rule" aria-hidden="true" />
          </div>
          <div className={`hm-stack${mark(personal && parts.some((p) => p.forYou))}`} data-testid="hm-parts">
            {parts.map((p, i) => (
              <article key={p.key} className="hm-part" data-testid="hm-part">
                <Img p={p.photo} sizes="(max-width: 460px) 100vw, 420px" />
                <div className="hm-part-body">
                  <span className="hm-part-n hm-serif">PART {i + 1}</span>
                  <h3 className="hm-part-title hm-serif" style={{ margin: 0 }}>
                    {p.title}
                  </h3>
                  {p.shift ? (
                    <div>
                      <span className="hm-label">THE SHIFT:</span> {p.shift}
                    </div>
                  ) : null}
                  {p.forYou ? (
                    <div className="hm-note" data-testid="hm-for-you">
                      <span className="hm-label">FOR YOU:</span> {p.forYou}
                    </div>
                  ) : null}
                  {p.familiar ? (
                    <div className="hm-note hm-note-italic">
                      <span className="hm-label">SOUND FAMILIAR?</span> {p.familiar}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {example ? (
            <div className={`hm-example${mark(personal)}`} data-testid="hm-example">
              <span className="hm-label">EXAMPLE</span>
              {example.title.trim() ? <div className="hm-example-title hm-serif">{example.title}</div> : null}
              <p>{example.text}</p>
            </div>
          ) : null}
          <SeatLink label={cta} sub={`${w.banner} · LIVE ONLINE`} inline />
        </div>
      </section>

      <section className="hm-section hm-glow">
        <div className="hm-wrap hm-narrow hm-stack">
          <div className="hm-heading">
            <span className="hm-kicker">Before and after</span>
            <h2 className="hm-h2 hm-serif">The Inner Circle call on {w.date}</h2>
            <div className="hm-rule" aria-hidden="true" />
          </div>
          <div className="hm-grid">
            <div className="hm-box">
              <div className="hm-box-title hm-serif" style={{ textAlign: "center" }}>
                Before
              </div>
              <ul className="hm-list">
                {BEFORE.map((t) => (
                  <li key={t}>
                    <span aria-hidden="true">✗</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hm-box hm-box-gold">
              <div className="hm-box-title hm-serif hm-gold" style={{ textAlign: "center" }}>
                After
              </div>
              <ul className="hm-list">
                {AFTER.map((t) => (
                  <li key={t}>
                    <span className="hm-mark-yes" aria-hidden="true">
                      ✓
                    </span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="hm-section hm-paper">
        <div className="hm-wrap hm-narrow hm-stack">
          {proofs.length ? (
            <>
              <div className="hm-heading">
                <span className="hm-kicker">In their words</span>
                <h2 className="hm-h2 hm-serif">From people I&apos;ve worked with</h2>
                <div className="hm-rule" aria-hidden="true" />
              </div>
              <div className={`hm-grid hm-grid-3${mark(personal)}`} data-testid="hm-proof">
                {proofs.map((p) => (
                  <figure key={p.id} className="hm-proof">
                    <blockquote>&ldquo;{p.quote}&rdquo;</blockquote>
                    {p.who ? <figcaption>{p.who}</figcaption> : null}
                  </figure>
                ))}
              </div>
            </>
          ) : preview ? (
            <div className="hm-example hm-personal" data-testid="hm-proof-placeholder">
              <span className="hm-label">PROOF</span>
              <p>No Proof Bank item fits yet: approved, with the permission tick. Prospects don&apos;t see this block.</p>
            </div>
          ) : null}
          <div className="hm-heading">
            <h2 className="hm-h2 hm-serif">Why listen to me?</h2>
            <div className="hm-rule" aria-hidden="true" />
          </div>
          <div className="hm-grid hm-grid-3">
            {WHY_LISTEN.map((x) => (
              <figure key={x.photo.src} className="hm-figure">
                <Img p={x.photo} sizes="(max-width: 760px) 100vw, 360px" />
                <figcaption>
                  <strong>{x.lead}</strong> {x.text}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="hm-section hm-dark">
        <div className="hm-wrap hm-narrow hm-stack">
          <div className="hm-grid hm-grid-3">
            <div className="hm-fact">
              <h3 className="hm-serif">WHAT</h3>
              <p>{WHAT}</p>
            </div>
            <div className="hm-fact hm-fact-gold">
              <h3 className="hm-serif">WHEN</h3>
              <p data-testid="hm-when-card">{whenCard(w, ctx.minutes)}</p>
            </div>
            <div className="hm-fact">
              <h3 className="hm-serif">WHY</h3>
              <p>{WHY}</p>
            </div>
          </div>
          <h2 className="hm-h2 hm-serif" style={{ textAlign: "center", marginTop: 16 }}>
            Questions
          </h2>
          <div className="hm-faq" data-testid="hm-faq">
            {objection ? (
              <details open className={mark(personal)} data-testid="hm-objection">
                <summary>{objection.objection}</summary>
                <p>{objection.answer}</p>
              </details>
            ) : null}
            {faq(w, ctx.minutes).map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="seat" className="hm-seat">
        <div className="hm-wrap hm-narrow">
          <div className="hm-seat-text">
            <h2 className="hm-h2 hm-serif" style={{ fontSize: "clamp(32px, 7vw, 44px)" }}>
              Claim your <span className="hm-gold">seat</span>
            </h2>
            <p>{w.full} · live online.</p>
            <p className="hm-ps">
              <strong>P.S.</strong> {ps(w)}
            </p>
          </div>
          <SeatForm code={code} webinarId={code ? null : ctx.webinarId} prefill={prefill} cta={cta} sub={`${w.banner} · LIVE ONLINE`} error={formError} preview={preview} />
        </div>
      </section>

      <Footer />
    </div>
  );
}

export function Footer() {
  return (
    <footer className="hm-footer">
      <div className="hm-wrap">
        <Img p={PHOTO.logo} sizes="56px" />
        <span style={{ maxWidth: 720 }}>{FOOTER_META}</span>
        <span>© {new Date().getFullYear()} Evolve Omega</span>
      </div>
    </footer>
  );
}
