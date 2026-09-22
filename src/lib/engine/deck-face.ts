/**
 * What a slide face never carries: words about how the deck was built rather than what the presenter says to the room. Consent,
 * verification, a missing item, an internal rule, a field label. They are true and they matter, to the coach: so they go to the
 * speaker notes and the Deck step, never onto a face. One list, here, read by the deck engine (which keeps them off every face)
 * and by the deck walk (which fails the build if one reaches a face of the exported file).
 *
 * The list is deliberately narrow: each pattern is a phrase that has no business in front of an audience, not a word that
 * might. A line that trips one loses only the clause that tripped it; the rest of the line stays on the face.
 */
import { CURRENCIES, CURRENCY_SYMBOL } from "./offer-score";

export type FaceClass = "consent" | "verification" | "missing" | "rule" | "label";
export const FACE_CLASS_LABEL: Record<FaceClass, string> = { consent: "consent", verification: "verification", missing: "a missing item", rule: "an internal rule", label: "a field label" };

/**
 * Each class, its pattern, and the live lines (22 Sep, "Your Edge, Uncovered") that prove it: the unit test runs every example. The
 * order is the order a clause is named in, so "no consented case study exists" is a missing item before it is a consent line.
 */
export const FACE_WORDS: { cls: FaceClass; pattern: RegExp; examples: string[] }[] = [
  {
    cls: "missing",
    pattern: /\bno (?:[a-z]+ ){0,2}(?:case stud(?:y|ies)|proofs?|testimonials?|stor(?:y|ies)|evidence|citations?|examples?) (?:exists?|yet|available|on file|for (?:this|that))\b|\b(?:TBD|TBC|TODO)\b|\bto be (?:added|confirmed|written)\b|\b(?:add|insert) (?:a |the )?(?:proof|story|case study|testimonial|stat|number) here\b/i,
    examples: ["NO CONSENTED CASE STUDY EXISTS FOR THIS ACT", "Client result TBD", "Insert a testimonial here"],
  },
  {
    cls: "consent",
    pattern: /\bconsent(?:ed|s)?\b|\bpermission (?:given|granted|recorded|ticked|on file)\b|\bapproved (?:for use|to share)\b/i,
    examples: ["Consent recorded 12 September 2026", "Kate A. (permission on file)"],
  },
  {
    cls: "verification",
    pattern: /\bverified\b|\bverbatim\b|\bunverified\b|\bfact[- ]checked\b|\bsource (?:checked|confirmed)\b/i,
    examples: ["verified verbatim", "Figures fact-checked 20 Sep"],
  },
  {
    cls: "rule",
    pattern: /\bno (?:fake |false )?(?:countdowns?|strike-?through|stack theat(?:re|er)|scarcity theat(?:re|er))\b|\bstack theat(?:re|er)\b|\b(?:fake|false) (?:scarcity|urgency)\b/i,
    examples: ["no countdown, no strikethrough, no stack theatre", "No fake scarcity on this slide"],
  },
];

/**
 * The field labels a record's text can carry in from a form ("Real: …"): printed on a face they read as the form, not the talk.
 * Only a label at the very start of a line, followed by a colon, and only these: "From:", "To:", "Payment plan:" and "Your
 * price:" are the deck's own audience-facing lines and are not here.
 */
export const FACE_LABELS = ["Real", "Perceived", "Claim", "Source", "Status", "Note", "Notes", "Internal", "Presenter note", "Speaker note", "Art direction", "Visual direction", "Delivery", "Consent", "Verified", "Placeholder", "TODO"] as const;
const LABEL_RE = new RegExp(`^\\s*(${FACE_LABELS.map((l) => l.replace(/ /g, "\\s+")).join("|")})\\s*:\\s*`, "i");

/** Every class a line carries, in the list's order. Empty means the line may stand on a face. */
export function faceHits(text: string): FaceClass[] {
  const out: FaceClass[] = [];
  if (LABEL_RE.test(text)) out.push("label");
  for (const w of FACE_WORDS) if (w.pattern.test(text)) out.push(w.cls);
  return out;
}

export type KeptOff = { cls: FaceClass; text: string };
const firstHit = (s: string): FaceClass | null => FACE_WORDS.find((w) => w.pattern.test(s))?.cls ?? null;
/** Spaced dashes, the middle dot and the semicolon mark an annotation; a sentence end marks a new sentence. Commas only inside a clause that already tripped. */
const SEPARATORS = /(\s+[—–-]\s+|\s+·\s+|;\s+|(?<=[.!?])\s+)/;
const DANGLING = /^[\s—–\-·;,:]+|[\s—–\-·;,:]+$/g;

/**
 * One line made fit for a face: a leading field label comes off, then each clause that trips a class comes off, and whatever is
 * left stands. A parenthesis that trips comes off whole; inside a tripped clause the comma-parts that do not trip are kept, so
 * "Kate A., consent recorded 12 Sep" keeps "Kate A.". What came off is returned, class and words, for the notes and the Deck step.
 */
export function cleanFace(line: string): { face: string; kept: KeptOff[] } {
  const kept: KeptOff[] = [];
  let text = line;
  const label = text.match(LABEL_RE);
  if (label) {
    kept.push({ cls: "label", text: `${label[1]}:` });
    text = text.slice(label[0].length);
  }
  text = text.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => {
    const cls = firstHit(inner);
    if (!cls) return whole;
    kept.push({ cls, text: inner.trim() });
    return "";
  });
  const parts = text.split(SEPARATORS);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i];
    const sep = i > 0 ? parts[i - 1] : "";
    if (!firstHit(clause)) {
      out.push(out.length ? sep : "", clause);
      continue;
    }
    const commaParts = clause.split(/,\s+/);
    const keep = commaParts.filter((c) => !firstHit(c));
    const tripped = commaParts.filter((c) => firstHit(c));
    kept.push({ cls: firstHit(tripped[0])!, text: tripped.join(", ").replace(DANGLING, "") });
    if (keep.length) out.push(out.length ? sep : "", keep.join(", "));
  }
  // Nothing tripped: the line stands exactly as written ("— Kate A." keeps its dash).
  if (!kept.length) return { face: line, kept };
  const face = out.join("").replace(DANGLING, "").trim();
  return { face: /[\p{L}\p{N}]/u.test(face) ? face : "", kept };
}

/* ───────────── One currency per deck ───────────── */

const CODE_RE = new RegExp(`\\b(${CURRENCIES.join("|")})\\b`, "g");
/**
 * The currencies a line names: every code written out, and a bare symbol only where it can name one family — "£" is sterling
 * and "€" the euro, while "$" is several and names nothing a code does not. So "NZD $1,997" is NZD, and "$1,997" alone is "$".
 */
export function currenciesIn(text: string): string[] {
  const out = new Set<string>(text.toUpperCase().match(CODE_RE) ?? []);
  if (/£\s?\d/.test(text)) out.add("GBP");
  if (/€\s?\d/.test(text)) out.add("EUR");
  if (/\$\s?\d/.test(text)) out.add("$");
  return [...out];
}

/**
 * Whether a line's currencies disagree with the offer's: a code that is not the offer's, a pound or euro sign on another
 * currency, or a dollar sign on an offer priced in pounds or euros. Returns what the line names that the offer does not.
 */
export function currencyConflicts(text: string, currency: string): string[] {
  const own = currency.toUpperCase();
  const ownSymbol = CURRENCY_SYMBOL[own] ?? "";
  return currenciesIn(text).filter((c) => (c === "$" ? ownSymbol !== "$" : c !== own));
}
