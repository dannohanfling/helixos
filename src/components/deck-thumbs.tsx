"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { googleFontHref } from "@/lib/engine/fonts";
import { boxAt, COVER_LOGO_PLACEHOLDER, PLACEHOLDER_RED, PLACEHOLDER_TEXT_SIZE, type BoxGeometry, type SlideGeometry, type SlidePlan, type TextBox } from "@/lib/engine/deck";

/** What one thumbnail needs, computed on the server from the same plan the export draws. */
export type ThumbSlide = {
  plan: SlidePlan;
  geometry: SlideGeometry;
  /** The picture in the slot, as the browser may fetch it, and how it sits in its frame; null when the slot is empty or the picture is private to the Proof Bank. */
  image: { url: string | null; mode: "cover" | "contain" } | null;
  /** The slide's section or kind, for the caption under the thumbnail. */
  label: string;
};
export type ThumbChrome = {
  faces: { display: string; body: string; quote: string | null; fallback: string };
  footerBar: boolean;
  ctaBar: boolean;
  ctaFooter: string | null;
  company: string;
  muted: string;
  surface: string;
  /** The footer bar's logo. */
  logoUrl: string | null;
  /** The cover's (first-deck §3): the kit's dark logo on a dark cover, else the one logo; null when there is none. */
  coverLogoUrl: string | null;
  /** The kit's ground behind a cover logo that would not read on the dark cover; null when it stands bare. */
  coverBadge: string | null;
  logoBox: BoxGeometry | { x: number; y: number; w: number; h: number };
  coverLogoBox: { x: number; y: number; w: number; h: number };
};

const SLIDE_W = 10;
const SLIDE_H = 5.625;
/** One point as a fraction of the slide's width: the thumbnail scales its type with its own width (container query units). */
const PT = 100 / SLIDE_W / 72;

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const place = (b: { x: number; y: number; w: number; h: number }) => ({ left: pct(b.x, SLIDE_W), top: pct(b.y, SLIDE_H), width: pct(b.w, SLIDE_W), height: pct(b.h, SLIDE_H) });
const face = (name: string, fallback: string) => [name, fallback, "Arial", "sans-serif"].filter((f, i, a) => f && a.indexOf(f) === i).map((f) => `"${f}"`).join(", ");

/**
 * The deck's slides as the export lays them out (deck visuals brief §6.4): an HTML twin of the render plan, not a picture of
 * the file. Every box sits where the plan's geometry puts it, in the kit's colours and faces, with the picture or the red
 * placeholder in its frame and the footer and CTA bands where the route draws them. The browser measures each text box after
 * layout: text past its box marks the slide "overflow", which is what the check before download counts (§6.5). A slide with
 * an empty slot or a deck with no logo is marked too. The thumbnail scales its type with its width, so a 300 px thumbnail and
 * a 600 px one show the same slide.
 */
export function DeckThumbs({ slides, chrome, hasLogo, onMeasured }: { slides: ThumbSlide[]; chrome: ThumbChrome; hasLogo: boolean; /** Told the number of slides whose text runs past its box, each time it is measured (§6.5). */ onMeasured?: (overflow: number) => void }) {
  const [overflow, setOverflow] = useState<Set<number>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  // The kit's Google faces, loaded so the thumbnails draw the faces the file names (first-deck §6); a licensed face stays the
  // fallback. Added to the head after render, never in it: a stylesheet React waits on would hold the whole step back when the
  // font host is slow or blocked, and the fallback is the right drawing until the face arrives (the measure runs again then).
  const fontKey = [chrome.faces.display, chrome.faces.body, chrome.faces.quote ?? ""].join("|");
  useEffect(() => {
    for (const href of new Set(fontKey.split("|").map(googleFontHref).filter((h): h is string => Boolean(h)))) {
      if (document.head.querySelector(`link[data-deck-font="${href}"]`)) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.deckFont = href;
      link.dataset.testid = "deck-thumb-font";
      document.head.appendChild(link);
    }
  }, [fontKey]);
  useEffect(() => {
    const measure = () => {
      const out = new Set<number>();
      root.current?.querySelectorAll<HTMLElement>("[data-measure]").forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) out.add(Number(el.dataset.measure));
      });
      setOverflow((prev) => (prev.size === out.size && [...prev].every((n) => out.has(n)) ? prev : out));
      onMeasured?.(out.size);
    };
    measure();
    const t = setTimeout(measure, 600); // a web face arriving after first paint can change the measure
    const ro = typeof ResizeObserver !== "undefined" && root.current ? new ResizeObserver(measure) : null;
    if (ro && root.current) ro.observe(root.current);
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
    };
  }, [slides, onMeasured]);

  const empty = slides.filter((s) => s.plan.placeholderSlot).map((s) => s.plan.n);
  const summary = [
    `${overflow.size} ${overflow.size === 1 ? "slide" : "slides"} with text past its box`,
    `${empty.length} ${empty.length === 1 ? "empty picture slot" : "empty picture slots"}`,
    hasLogo ? null : "no logo",
  ].filter(Boolean);
  return (
    <div ref={root}>
      <p className="mb-2 text-xs text-ink-3" data-testid="deck-thumbs-summary" data-overflow={overflow.size} data-empty={empty.length} data-nologo={hasLogo ? 0 : 1}>
        Laid out as the file will be. {summary.join(" · ")}. Measured here in your browser, in your kit&apos;s faces; a licensed face is drawn in the fallback, which is what a reader without it sees too.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {slides.map((s) => (
          <Thumb key={s.plan.n} slide={s} chrome={chrome} overflow={overflow.has(s.plan.n)} missingLogo={!hasLogo && (s.plan.n === 1 || (chrome.footerBar && !s.plan.pictureOnly))} />
        ))}
      </div>
    </div>
  );
}

function Thumb({ slide, chrome, overflow, missingLogo }: { slide: ThumbSlide; chrome: ThumbChrome; overflow: boolean; missingLogo: boolean }) {
  const { plan, geometry: g, image } = slide;
  const cover = plan.boxes.some((b) => b.role === "cover-title");
  const problems = [plan.placeholderSlot ? "empty slot" : null, overflow ? "overflow" : null, missingLogo ? "no logo" : null].filter(Boolean) as string[];
  const faceFor = (b: { face: string }) => face(b.face, chrome.faces.fallback);
  // Every box where the plan's geometry puts it, in its column when it sits in a row (big numbers, cards): the export's own rule.
  const boxEl = (b: TextBox, i: number) => {
    const at = boxAt(g, b);
    if (!at) return null;
    const role = b.role;
    return (
      <div
        key={`${role}:${b.col ?? ""}:${i}`}
        data-measure={plan.n}
        data-role={role}
        data-col={b.col}
        data-x={at.x}
        data-y={at.y}
        data-w={at.w}
        data-h={at.h}
        className="absolute flex overflow-hidden leading-[1.2]"
        style={{ ...place(at), alignItems: at.valign === "middle" ? "center" : "flex-start", justifyContent: at.align === "center" ? "center" : at.align === "right" ? "flex-end" : "flex-start", textAlign: at.align, color: `#${b.color}`, fontFamily: faceFor(b), fontSize: `${b.size * PT}cqw`, fontWeight: b.bold ? 700 : 400, fontStyle: b.italic ? "italic" : "normal", textDecoration: b.strike ? "line-through" : undefined, whiteSpace: "pre-line", backgroundColor: b.fill ? `#${b.fill}` : undefined }}
      >
        <span>{b.text}</span>
      </div>
    );
  };
  const lines = plan.boxes.filter((b) => b.role === "body" || b.role === "attribution");
  const frame = plan.imageFrame ?? plan.placeholderSlot?.frame ?? null;
  const bandY = 5.32;
  return (
    <figure className="m-0" data-testid="deck-thumb" data-n={plan.n} data-overflow={overflow ? 1 : 0} data-empty={plan.placeholderSlot ? 1 : 0} data-nologo={missingLogo ? 1 : 0} data-layout={plan.layout}>
      <div className={`relative w-full overflow-hidden rounded border ${problems.length ? "border-warn ring-1 ring-warn" : "border-line"}`} style={{ aspectRatio: "16 / 9", backgroundColor: `#${plan.background}`, containerType: "inline-size" }}>
        {cover && chrome.coverLogoUrl ? (
          <div className="absolute" style={place(chrome.coverLogoBox)}>
            {/* The badge hugs the drawn logo, as the export's does: an inline-block around the contained picture. */}
            <span className="inline-block max-h-full max-w-full" style={chrome.coverBadge ? { backgroundColor: `#${chrome.coverBadge}`, borderRadius: "0.8cqw", padding: "1cqw" } : undefined} data-testid={chrome.coverBadge ? "deck-thumb-logo-badge" : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={chrome.coverLogoUrl} alt="" className="block object-contain object-left" style={{ maxWidth: "100%", maxHeight: `${chrome.coverLogoBox.h * (100 / SLIDE_W) - (chrome.coverBadge ? 2 : 0)}cqw` }} data-testid="deck-thumb-cover-logo" />
            </span>
          </div>
        ) : cover && missingLogo ? (
          <div className="absolute flex items-center justify-center border border-dashed text-center" style={{ ...place(chrome.coverLogoBox), borderColor: `#${PLACEHOLDER_RED}`, color: `#${PLACEHOLDER_RED}`, fontSize: `${PLACEHOLDER_TEXT_SIZE * PT}cqw`, fontFamily: face(chrome.faces.body, chrome.faces.fallback) }} data-testid="deck-thumb-logo-placeholder">
            {COVER_LOGO_PLACEHOLDER}
          </div>
        ) : null}
        {(plan.panels ?? []).map((p, i) => (
          <div key={`panel:${i}`} className={`absolute ${p.ring ? "rounded-full" : "rounded"}`} style={{ ...place(p.frame), ...(p.ring ? { border: `${p.ring * PT}cqw solid #${p.color}` } : { backgroundColor: `#${p.color}` }) }} data-testid={p.ring ? "deck-thumb-seal" : "deck-thumb-panel"} />
        ))}
        {plan.boxes.map((b, i) => (b.role === "body" || b.role === "attribution" || b.role === "footer" ? null : boxEl(b, i)))}
        {lines.length && g.body ? (
          <div data-measure={plan.n} data-role="body" data-x={g.body.x} data-y={g.body.y} data-w={g.body.w} data-h={g.body.h} className="absolute overflow-hidden leading-[1.2]" style={{ ...place(g.body), textAlign: "left" }}>
            {lines.map((b, i) => (
              <div key={i} style={{ color: `#${b.color}`, fontFamily: faceFor(b), fontSize: `${b.size * PT}cqw`, backgroundColor: b.fill ? `#${b.fill}` : undefined }}>
                {b.bullet ? "• " : ""}
                {b.text}
              </div>
            ))}
          </div>
        ) : null}
        {plan.boxes.map((b, i) => (b.role === "footer" ? boxEl(b, i) : null))}
        {plan.rules.map((r, i) => (
          <div key={i} className="absolute" style={{ left: pct(g.rules.x, SLIDE_W), top: pct(r.y, SLIDE_H), width: pct(g.rules.w, SLIDE_W), height: "1.5px", backgroundColor: `#${r.color}` }} />
        ))}
        {frame && image?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.url} alt="" className="absolute" style={{ ...place(frame), objectFit: image.mode, backgroundColor: `#${plan.background}` }} data-testid="deck-thumb-picture" />
        ) : frame && image && !image.url ? (
          <div className="absolute flex items-center justify-center rounded-sm bg-surface-2 text-center text-ink-3" style={{ ...place(frame), fontSize: `${12 * PT}cqw` }}>
            the approved proof&apos;s photo
          </div>
        ) : plan.placeholderSlot ? (
          <div className="absolute flex items-center justify-center border border-dashed text-center" style={{ ...place(plan.placeholderSlot.frame), borderColor: `#${plan.placeholderSlot.color}`, color: `#${plan.placeholderSlot.color}`, fontSize: `${PLACEHOLDER_TEXT_SIZE * PT}cqw`, fontFamily: face(chrome.faces.body, chrome.faces.fallback), padding: "4%" }} data-testid="deck-thumb-placeholder">
            {plan.placeholderSlot.text}
          </div>
        ) : null}
        {!cover && chrome.footerBar ? (
          <div className="absolute" style={{ left: 0, top: pct(bandY, SLIDE_H), width: "100%", height: pct(0.3, SLIDE_H), backgroundColor: `#${chrome.surface}` }}>
            {chrome.logoUrl ? null : <div className="absolute flex items-center" style={{ left: pct(0.4, SLIDE_W), width: pct(3.5, SLIDE_W), height: "100%", color: `#${chrome.muted}`, fontFamily: face(chrome.faces.body, chrome.faces.fallback), fontSize: `${9 * PT}cqw` }} data-testid="deck-thumb-footer-brand">{chrome.company}</div>}
            {chrome.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={chrome.logoUrl} alt="" className="absolute object-contain object-right" style={{ left: pct(chrome.logoBox.x, SLIDE_W), top: pct(chrome.logoBox.y - bandY, 0.3), width: pct(chrome.logoBox.w, SLIDE_W), height: pct(chrome.logoBox.h, 0.3) }} />
            ) : null}
          </div>
        ) : null}
        {!cover && plan.ctaBar ? (
          <div className="absolute flex items-center justify-center font-bold" style={{ left: pct(4.0, SLIDE_W), top: pct(bandY, SLIDE_H), width: pct(4.8, SLIDE_W), height: pct(0.3, SLIDE_H), color: `#${chrome.muted}`, fontFamily: face(chrome.faces.body, chrome.faces.fallback), fontSize: `${10 * PT}cqw` }} data-testid="deck-thumb-cta">{plan.ctaBar}</div>
        ) : null}
      </div>
      <figcaption className="mt-1 flex items-center justify-between text-[11px] text-ink-3">
        <span>
          {plan.n} · {slide.label}
        </span>
        {problems.length ? <span className="font-medium text-warn" data-testid="deck-thumb-problems">{problems.join(" · ")}</span> : null}
      </figcaption>
    </figure>
  );
}

/** What the server already knows before download (§6.5); the overflow count comes from the thumbnails' measure in the browser. */
export type DeckCheckCounts = { emptySlots: number; placeholders: number; missingLogo: boolean; licensedNoFallback: number; dropped: number; /** Slides whose boxes sit on top of each other, from the plan's own geometry (deck re-test §1). */ overlaps: number };

/**
 * The check before download (deck visuals brief §6.5): one panel above "Download .pptx" that counts what a client should look
 * at first: empty picture slots, slides whose text runs past its box (measured on the thumbnails below, not guessed), a missing
 * logo, a licensed face with no fallback, and unfilled [placeholders]. Nothing here blocks the download; it says what the file
 * will carry. The download controls sit inside the panel so the count is read before the button.
 */
export function DeckCheck({ counts, slides, chrome, hasLogo, downloads }: { counts: DeckCheckCounts; slides: ThumbSlide[]; chrome: ThumbChrome; hasLogo: boolean; downloads: ReactNode }) {
  const [overflow, setOverflow] = useState<number | null>(null);
  const items: { key: string; n: number; text: string }[] = [
    { key: "empty", n: counts.emptySlots, text: counts.emptySlots === 1 ? "1 empty picture slot: that slide exports with a red placeholder" : `${counts.emptySlots} empty picture slots: those slides export with red placeholders` },
    { key: "overflow", n: overflow ?? 0, text: overflow === null ? "measuring the text against its boxes…" : overflow === 1 ? "1 slide with text past its box" : `${overflow} slides with text past their box` },
    { key: "overlaps", n: counts.overlaps, text: counts.overlaps === 1 ? "1 slide with boxes on top of each other" : `${counts.overlaps} slides with boxes on top of each other` },
    { key: "logo", n: counts.missingLogo ? 1 : 0, text: "no logo: the cover shows a red “Your logo here” box, and the footer bar sets the brand line as type" },
    { key: "face", n: counts.licensedNoFallback, text: "a licensed face with no fallback: readers without it will see their app's own substitute" },
    { key: "placeholders", n: counts.placeholders, text: counts.placeholders === 1 ? "1 unfilled [placeholder] in the text" : `${counts.placeholders} unfilled [placeholders] in the text` },
  ];
  const open = items.filter((i) => i.n > 0);
  const total = open.reduce((a, i) => a + i.n, 0);
  return (
    <div>
      <div className={`mb-3 rounded-lg border p-3 ${total ? "border-warn bg-warn-soft" : "border-good bg-good-soft"}`} data-testid="deck-check" data-total={total} data-empty={counts.emptySlots} data-overflow={overflow ?? ""} data-logo-missing={counts.missingLogo ? 1 : 0} data-face={counts.licensedNoFallback} data-placeholders={counts.placeholders}>
        <p className="text-sm font-semibold" data-testid="deck-check-line">
          {overflow === null ? "Checking the slides…" : total === 0 ? "Nothing to fix before you download." : `${total} ${total === 1 ? "thing" : "things"} to look at before you download.`}
        </p>
        {open.length ? (
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">
            {open.map((i) => (
              <li key={i.key} data-testid={`deck-check-${i.key}`}>{i.text}</li>
            ))}
          </ul>
        ) : null}
        {counts.dropped ? <p className="mt-1 text-xs text-ink-3">{counts.dropped === 1 ? "1 picture you said you don't have exports as text, no placeholder." : `${counts.dropped} pictures you said you don't have export as text, no placeholder.`}</p> : null}
        {downloads ? <div className="mt-2">{downloads}</div> : null}
      </div>
      <details className="mb-4" open data-testid="deck-thumbs">
        <summary className="cursor-pointer text-sm font-semibold">See the slides as the file lays them out</summary>
        <div className="mt-2">
          <DeckThumbs slides={slides} chrome={chrome} hasLogo={hasLogo} onMeasured={setOverflow} />
        </div>
      </details>
    </div>
  );
}

