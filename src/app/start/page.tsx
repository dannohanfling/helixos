import Image from "next/image";
import { Pixel } from "@/components/hermes/pixel";
import {
  AUDIENCE_LINE,
  BAR,
  CHAMBER,
  CHECKOUT_URL,
  CLOSING,
  DAY_STEPS,
  FAQ,
  FEATURES,
  FOOTER,
  HERO,
  LETTER,
  PROBLEM,
  PROOF,
  PROOF_LABEL,
  START,
  funnelPixelId,
} from "@/lib/hermes/funnel";

/**
 * Funnel 1 at /start (H-674, plan H-721, Danno's answers H-841): one page, one call to action, Start with me, to the existing
 * checkout. No prices, sample data only in the phone pictures. The Meta Pixel's PageView beacon only when Vercel has
 * FUNNEL_PIXEL_ID. Since H-1725 (approved in H-1727): a strip of approved quotes under the letter, and a gold reading bar.
 */
export const dynamic = "force-dynamic";

const IMG = "/hermes/funnel1";

function Check() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#DDA338" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function StartButton({ wide = false, testId }: { wide?: boolean; testId: string }) {
  return (
    <a className={`fn-btn fn-btn-gold${wide ? " fn-btn-wide" : ""}`} href={CHECKOUT_URL} data-testid={testId}>
      {START.button}
    </a>
  );
}

export default function FunnelPage() {
  const pixelId = funnelPixelId();
  return (
    <div className="fn-root" data-testid="fn-root">
      <div className="fn-progress" aria-hidden="true" data-testid="fn-progress" />
      <div className="fn-bar" data-testid="fn-bar">{BAR}</div>

      <header className="fn-wrap fn-nav">
        <div className="fn-brand">
          <Image src={`${IMG}/medallion.png`} alt="Evolve Omega medallion" width={44} height={44} />
          <span className="fn-wordmark">HELIXOS</span>
        </div>
        <a className="fn-btn fn-btn-line" href="#start" data-testid="fn-nav-start">
          {START.button}
        </a>
      </header>

      <main>
        <section className="fn-wrap fn-hero" aria-labelledby="fn-hero-title">
          <div className="fn-hero-copy">
            <div className="fn-eyebrow">{HERO.eyebrow}</div>
            <h1 id="fn-hero-title" className="fn-h1" data-testid="fn-hero-title">
              {HERO.title}
            </h1>
            <p className="fn-lead">{HERO.lead}</p>
            <StartButton testId="fn-start-hero" />
            <div className="fn-small" data-testid="fn-audience">{AUDIENCE_LINE}</div>
          </div>
          <div className="fn-hero-image">
            <Image src={`${IMG}/hero-duo.webp`} alt={HERO.imageAlt} width={1483} height={1498} priority sizes="(max-width: 860px) 100vw, 540px" />
          </div>
        </section>

        <section className="fn-band">
          <div className="fn-wrap fn-centered">
            <h2 className="fn-h2">{PROBLEM.title}</h2>
            <p className="fn-p">{PROBLEM.body}</p>
          </div>
        </section>

        <section className="fn-wrap fn-features" aria-label="What HelixOS does">
          {FEATURES.map((f, i) => (
            <div key={f.key} className={`fn-feature${i % 2 ? " fn-flip" : ""}`} data-testid={`fn-feature-${f.key}`}>
              <Image src={`${IMG}/${f.image}`} alt={f.alt} width={633} height={1314} sizes="(max-width: 860px) 200px, 270px" />
              <div className="fn-feature-copy">
                <div className="fn-eyebrow">{f.eyebrow}</div>
                <h3 className="fn-h3">{f.title}</h3>
                <p className="fn-p">{f.body}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="fn-wrap fn-chamber">
          <div className="fn-chamber-frame" data-testid="fn-chamber">
            <Image src={`${IMG}/council-night.webp`} alt={CHAMBER.alt} width={1400} height={787} sizes="(max-width: 1160px) 100vw, 1112px" />
            <div className="fn-chamber-caption">
              <div className="fn-eyebrow">{CHAMBER.eyebrow}</div>
              <div className="fn-chamber-title">{CHAMBER.title}</div>
            </div>
          </div>
        </section>

        <section className="fn-wrap fn-day" aria-labelledby="fn-day-title">
          <h2 id="fn-day-title" className="fn-h2">How a day works</h2>
          <ol className="fn-grid3">
            {DAY_STEPS.map((s) => (
              <li key={s.numeral} className="fn-card">
                <div className="fn-numeral" aria-hidden="true">{s.numeral}</div>
                <div className="fn-card-title">{s.title}</div>
                <div className="fn-card-body">{s.body}</div>
              </li>
            ))}
          </ol>
        </section>

        <section className="fn-letter" aria-labelledby="fn-letter-title" data-testid="fn-letter">
          <div className="fn-wrap">
            <div className="fn-eyebrow">{LETTER.eyebrow}</div>
            <h2 id="fn-letter-title" className="fn-h2">{LETTER.title}</h2>
            {LETTER.paragraphs.map((p) => (
              <p key={p.slice(0, 24)} className="fn-p">{p}</p>
            ))}
            <p className="fn-sign">{LETTER.signature}</p>
          </div>
        </section>

        <section className="fn-proof" aria-label={PROOF_LABEL} data-testid="fn-proof">
          <div className="fn-proof-view" tabIndex={0} aria-label={`${PROOF_LABEL}: focus or tap to pause`}>
            <div className="fn-proof-track">
              {[false, true].map((copy) => (
                <ul key={String(copy)} className="fn-proof-list" aria-hidden={copy || undefined}>
                  {PROOF.map((p) => (
                    <li key={p.quote.slice(0, 24)} className="fn-proof-card">
                      <p className="fn-proof-quote">&ldquo;{p.quote}&rdquo;</p>
                      <p className="fn-proof-who">{p.who}</p>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </section>

        <section id="start" className="fn-wrap fn-start" aria-labelledby="fn-start-title" data-testid="fn-start">
          <div className="fn-start-box">
            <div className="fn-start-copy">
              <div className="fn-eyebrow">{START.eyebrow}</div>
              <h2 id="fn-start-title" className="fn-h2">{START.title}</h2>
              <ul className="fn-list">
                {START.included.map((line) => (
                  <li key={line}>
                    <Check />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="fn-start-action">
              <StartButton wide testId="fn-start-box" />
            </div>
          </div>
        </section>

        <section className="fn-wrap fn-faq" aria-labelledby="fn-faq-title">
          <h2 id="fn-faq-title" className="fn-h2">Questions</h2>
          <dl>
            {FAQ.map((f) => (
              <div key={f.q} className="fn-faq-item">
                <dt>{f.q}</dt>
                <dd>{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="fn-closing">
          <div className="fn-wrap">
            <Image src={`${IMG}/medallion.png`} alt="" width={72} height={72} />
            <h2 className="fn-h2">{CLOSING.title}</h2>
            <StartButton testId="fn-start-closing" />
          </div>
        </section>
      </main>

      <footer className="fn-wrap fn-footer">
        <span>{FOOTER.owner}</span>
        <nav aria-label="Legal">
          {FOOTER.links.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>
      </footer>

      {pixelId ? (
        <span className="fn-pixel">
          <Pixel id={pixelId} event="PageView" />
        </span>
      ) : null}
    </div>
  );
}
