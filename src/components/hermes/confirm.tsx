import Image from "next/image";
import type { MfPitch } from "@/lib/engine/magic-funnel";
import type { CallContext } from "@/lib/hermes/data";
import { CONFIRM, HOST, PHOTO } from "@/lib/hermes/copy";
import { googleCalendarUrl } from "@/lib/hermes/when";
import { Footer } from "@/components/hermes/landing";
import { Pixel } from "@/components/hermes/pixel";

type Photo = { src: string; width: number; height: number; alt: string };
const Img = ({ p, className, sizes }: { p: Photo; className?: string; sizes: string }) => <Image src={p.src} width={p.width} height={p.height} alt={p.alt} className={className} sizes={sizes} />;

export type ConfirmProps = {
  ctx: CallContext;
  firstName: string;
  /** Their pitch when the engine wrote one: the ticket title and "Bring these" lines are theirs. */
  pitch: MfPitch | null;
  icsHref: string;
  preview?: boolean;
};

export function Confirm({ ctx, firstName, pitch, icsHref, preview }: ConfirmProps) {
  const w = ctx.when;
  const personal = Boolean(pitch);
  const mark = personal ? " hm-personal" : "";
  const ticket = pitch?.confirmation.ticket_title?.trim() || ctx.setup.defaults.ticketTitle?.trim() || ctx.title;
  const bring = (pitch?.confirmation.bring.length ? pitch.confirmation.bring : ctx.setup.defaults.bring.length ? ctx.setup.defaults.bring : CONFIRM.bringCold).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const details = `${ctx.title} with ${HOST}.\n${w.full}.\n${ctx.joinUrl ? `Join: ${ctx.joinUrl}` : "Your join link comes to you in Messenger."}`;
  const google = googleCalendarUrl({ title: ctx.title, details, when: w, location: ctx.joinUrl });

  return (
    <div className={`hm-root${preview ? " hm-marks" : ""}`} data-testid="hm-confirmed">
      {ctx.pixelId && !preview ? <Pixel id={ctx.pixelId} event="CompleteRegistration" /> : null}
      <div className="hm-bar">
        <div className="hm-wrap">
          <span className="hm-bar-text">{ctx.videoEmbed ? "Step 1 of 2 done. Watch the video below to finish." : `Your seat is saved · ${w.line}`}</span>
        </div>
      </div>

      <section className="hm-confirm-hero">
        <div className="hm-wrap">
          <Image src={PHOTO.logo.src} width={64} height={64} alt={PHOTO.logo.alt} priority />
          <h1 className="hm-h1 hm-serif" data-testid="hm-youre-in">
            You&apos;re in, <span className="hm-gold">{firstName}</span>.
          </h1>
          <p>{ctx.videoEmbed ? CONFIRM.subVideo : CONFIRM.sub(w)}</p>
          {ctx.videoEmbed ? (
            <div className="hm-video">
              <iframe src={ctx.videoEmbed} title={`A thank-you from ${HOST}`} allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" loading="lazy" data-testid="hm-video" />
            </div>
          ) : null}
        </div>
      </section>

      <main className="hm-wrap">
        <section className="hm-section hm-ticket-row" style={{ paddingTop: 36, paddingBottom: 36 }}>
          <div className="hm-ticket">
            <div className="hm-ticket-head">
              <small>Your ticket</small>
              <span className={`hm-ticket-title hm-serif${mark}`} data-testid="hm-ticket">
                {ticket}
              </span>
            </div>
            <dl className="hm-ticket-rows">
              <div>
                <dt>{ctx.title}</dt>
                <dd>with {HOST}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd data-testid="hm-ticket-day">{w.day}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd data-testid="hm-ticket-time">
                  {w.time}
                  {w.timeEt ? ` · ${w.timeEt}` : ""}
                </dd>
              </div>
              <div>
                <dt>Join link</dt>
                <dd data-testid="hm-join">{ctx.joinUrl ? <a href={ctx.joinUrl}>{ctx.joinUrl.replace(/^https:\/\//, "")}</a> : CONFIRM.noJoin}</dd>
              </div>
            </dl>
            <div className="hm-ticket-actions">
              <a className="hm-pill" href={google} target="_blank" rel="noopener noreferrer" data-testid="hm-google">
                Google Calendar
              </a>
              <a className="hm-pill hm-pill-line" href={icsHref} data-testid="hm-ics">
                Apple / Outlook
              </a>
            </div>
          </div>
          <Img p={PHOTO.hero} className="hm-ticket-photo" sizes="(max-width: 420px) 100vw, 380px" />
        </section>

        <section className="hm-section hm-stack" style={{ paddingTop: 36, paddingBottom: 36 }}>
          <h2 className="hm-h2 hm-serif" style={{ textAlign: "center" }}>
            Before <span className="hm-gold">{w.date}</span>
          </h2>
          <div className="hm-grid hm-grid-3" data-testid="hm-asks">
            {CONFIRM.asks(w).map((a, i) => (
              <div key={a.title} className="hm-box hm-box-gold hm-ask">
                <span className="hm-ask-n hm-serif" aria-hidden="true">
                  {i + 1}
                </span>
                <strong>{a.title}</strong>
                <span>{a.text}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="hm-section hm-closing" style={{ paddingTop: 36, paddingBottom: 80 }}>
          <div className={`hm-bring${mark}`} data-testid="hm-bring">
            <h2 className="hm-bring-title hm-serif" style={{ margin: 0 }}>
              Bring these, {firstName}
            </h2>
            <ul>
              {bring.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
          <div className="hm-signoff">
            <Img p={PHOTO.headshot} sizes="140px" />
            <p>{CONFIRM.signoff(w)}</p>
            <span className="hm-serif hm-gold" style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>
              DANNO
            </span>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
