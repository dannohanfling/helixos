/**
 * The speaker notes as a talk track, and the numbers check before download (deck layouts 14 and 15, rev 502; order agreed at
 * rev 535). Pure: both read the slides and the record's sections, never a model.
 *
 * 14. Each slide's notes open with what to say (the slice of its section's script that belongs to it) and its time (the
 *     section's minutes spread over its slides, and the elapsed time at the slide's end). The script is split on the slides'
 *     own points: each point is found in the script by its words, in order, and a slide's slice runs from its point to the
 *     next slide's. A point the script never says takes the script from the previous point's match on; a script that says
 *     none of its points is shared out in order. Only the coach's own words: nothing here writes a line.
 * 15. Figures that disagree: the same thing named with two numbers close to each other ("$5,043 week" and "$5,000 week"),
 *     across the slides and the scripts, listed with where each sits. A progression ("$1,500 then $5,000 week") is not a
 *     disagreement: only figures within 10% of each other are listed. Never a block.
 */

export type TalkSlide = { n: number; sectionKey: string | null; headline: string; body: string[] };
export type TalkSection = { sectionKey: string; name: string; script: string | null; durationMin: number; startMin: number };
export type Talk = { say: string | null; minutes: number; endMin: number };

const STOP = new Set("the and for you your with that this from have are was were but not they them then than what when who how its it's into out our we can will just all about more some one get got had has his her she him there their here also very only been being would could should".split(" "));
const words = (t: string): string[] => (t.toLowerCase().match(/[a-z0-9][a-z0-9'’]*/g) ?? []).map((w) => w.replace(/['’]s$/, "")).filter((w) => w.length >= 3 && !STOP.has(w));

/** The script as sentences, in order: a line break or a sentence's end closes one. */
export function sentences(script: string): string[] {
  return script
    .split(/\n+/)
    // Never after "2 a.m." or a title: "at 2 a.m. I wrote" is one sentence.
    .flatMap((line) => line.split(/(?<!\b(?:[ap]\.m|Mr|Mrs|Ms|Dr|St|vs|e\.g|i\.e)\.)(?<=[.!?…])["”’)]*\s+(?=["“‘(]?[A-Z0-9$£€])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** How much of a point's words a stretch of the script says, 0 to 1. */
const said = (point: string[], text: string): number => {
  if (!point.length) return 0;
  const have = new Set(words(text));
  return point.filter((w) => have.has(w)).length / point.length;
};

/** Where in the script each point is said, in order: the sentence index, or null when the script never says it. */
export function matchPoints(points: string[], sents: string[]): (number | null)[] {
  let from = 0;
  return points.map((p) => {
    const want = words(p);
    if (!want.length) return null;
    for (let j = from; j < sents.length; j++) {
      // A point can run over two sentences ("I sent 600 DMs. Two booked."): read each with the next as well.
      if (said(want, sents[j]) >= 0.6 || (j + 1 < sents.length && said(want, `${sents[j]} ${sents[j + 1]}`) >= 0.75 && said(want, sents[j]) >= 0.3)) {
        from = j + 1;
        return j;
      }
    }
    return null;
  });
}

/** The point a slide makes: its own line, or on a build (the same line as the slide before, one body line more) the new line. */
const pointOf = (s: TalkSlide, prev: TalkSlide | undefined): string => (prev && prev.headline === s.headline && s.body.length ? s.body[s.body.length - 1] : s.headline);

/** Minutes to the half minute, never under half a minute. */
const half = (m: number) => Math.max(0.5, Math.round(m * 2) / 2);

/** Each sectioned slide's talk track, by slide number. Slides with no section have none. */
export function talkTrack(slides: TalkSlide[], sections: TalkSection[]): Map<number, Talk> {
  const out = new Map<number, Talk>();
  for (const sec of sections) {
    const own = slides.filter((s) => s.sectionKey === sec.sectionKey);
    if (!own.length) continue;
    const share = sec.durationMin / own.length;
    const sents = sec.script ? sentences(sec.script) : [];
    let slices: (string | null)[] = own.map(() => null);
    if (sents.length) {
      const at = matchPoints(own.map((s, i) => pointOf(s, own[i - 1])), sents);
      if (at.every((x) => x === null)) {
        // None of the points is in the script: it is shared out in order, as evenly as its sentences allow.
        slices = own.map((_, i) => sents.slice(Math.round((i * sents.length) / own.length), Math.round(((i + 1) * sents.length) / own.length)).join(" ") || null);
      } else {
        const firstHit = at.findIndex((x) => x !== null);
        slices = own.map((_, i) => {
          // From this point's match (the first matched point takes the script's opening with it; an unmatched one takes the
          // script from the previous point's match on) to the next point's match.
          const prevHit = [...at.slice(0, i)].reverse().find((x) => x !== null) ?? null;
          const start = i <= firstHit ? 0 : (at[i] ?? prevHit ?? 0);
          const next = at.slice(i + 1).find((x) => x !== null) ?? sents.length;
          return sents.slice(start, Math.max(start + 1, next)).join(" ") || null;
        });
      }
    }
    own.forEach((s, i) => out.set(s.n, { say: slices[i], minutes: half(share), endMin: Math.round(sec.startMin + share * (i + 1)) }));
  }
  return out;
}

/** The notes' talk track lines, first in the notes: what to say, then the time. */
export function talkLines(t: Talk): string[] {
  return [...(t.say ? [`What to say: ${t.say}`] : []), `Time: about ${t.minutes} ${t.minutes === 1 ? "minute" : "minutes"} on this slide; ${t.endMin} ${t.endMin === 1 ? "minute" : "minutes"} in at its end.`];
}

/* ───────────── 15. Figures that disagree ───────────── */

export type FigureSeen = { text: string; where: string };
export type FigureClash = { unit: string; figures: FigureSeen[] };

const MONEY = /([$£€])\s?(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?\b/g;
const PERCENT = /(\d[\d,]*(?:\.\d+)?)\s?%/g;
const COUNT = /(?<![$£€\d.,])\b(\d[\d,]*(?:\.\d+)?)\b(?!\s?%)(?![.,]\d)/g;
const TIME_WORD = /^(?:days?|weeks?|months?|years?|hours?|minutes?|mins?|seconds?|am|pm|a\.m|p\.m)$/i;
const SKIP = new Set(["a", "an", "the", "then", "and", "or", "to", "in", "on", "of", "per", "for", "by", "at", "from", "with", "is", "was", "my", "your"]);
const toNumber = (n: string, mult?: string) => Number(n.replace(/,/g, "")) * (mult ? ({ k: 1e3, m: 1e6 } as Record<string, number>)[mult.toLowerCase()] : 1);
/** The word after a figure that says what it counts, as written and as a key (singular, lower case); null when it is a joining word. */
const unitAfter = (rest: string): { word: string; key: string } | null => {
  const word = rest.match(/^\s*([A-Za-z][A-Za-z-]*)/)?.[1];
  const w = word?.toLowerCase();
  if (!word || !w || SKIP.has(w)) return null;
  return { word, key: w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w };
};

type Seen = FigureSeen & { kind: string; unit: string; value: number };
function figuresIn(text: string, where: string): Seen[] {
  const out: Seen[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  for (const m of text.matchAll(MONEY)) {
    const unit = unitAfter(text.slice(m.index! + m[0].length));
    taken.push([m.index!, m.index! + m[0].length]);
    if (unit) out.push({ kind: m[1], unit: unit.key, value: toNumber(m[2], m[3]), text: `${m[0].trim()} ${unit.word}`, where });
  }
  for (const m of text.matchAll(PERCENT)) {
    taken.push([m.index!, m.index! + m[0].length]);
    const unit = unitAfter(text.slice(m.index! + m[0].length));
    if (unit) out.push({ kind: "%", unit: unit.key, value: toNumber(m[1]), text: `${m[0].trim()} ${unit.word}`, where });
  }
  for (const m of text.matchAll(COUNT)) {
    const end = m.index! + m[0].length;
    if (!free(m.index!, end)) continue;
    const value = toNumber(m[1]);
    const unit = unitAfter(text.slice(end));
    // Small counts are steps and days, not claims; a time is never the figure; a year is a date.
    if (value < 10 || !unit || TIME_WORD.test(unit.key) || (value >= 1900 && value <= 2100 && !m[1].includes(","))) continue;
    out.push({ kind: "#", unit: unit.key, value, text: `${m[0].trim()} ${unit.word}`, where });
  }
  return out;
}

/** Figures named for the same thing that sit within 10% of each other without matching, each with where it is. */
export function figureClashes(texts: { text: string; where: string }[]): FigureClash[] {
  const all = texts.flatMap((t) => figuresIn(t.text, t.where));
  const groups = new Map<string, Seen[]>();
  for (const f of all) groups.set(`${f.kind}|${f.unit}`, [...(groups.get(`${f.kind}|${f.unit}`) ?? []), f]);
  const clashes: FigureClash[] = [];
  for (const fs of groups.values()) {
    const values = [...new Set(fs.map((f) => f.value))];
    const close = fs.filter((f) => values.some((v) => v !== f.value && Math.abs(v - f.value) / Math.max(v, f.value) <= 0.1));
    if (!close.length) continue;
    const seen = new Set<string>();
    clashes.push({ unit: fs[0].unit, figures: close.filter((f) => !seen.has(`${f.text}|${f.where}`) && seen.add(`${f.text}|${f.where}`)).map(({ text, where }) => ({ text, where })) });
  }
  return clashes;
}
