/**
 * Fathom harvest, pure. The rules this file enforces in code, not in a prompt:
 *  - a quote is verbatim or it does not exist: anything the model returns that is not word for word in the transcript is dropped;
 *  - a shorter shape is a trim (an excerpt, with an ellipsis for the gap), never a rewrite;
 *  - who said it and when come from the transcript's own speaker labels and timestamps, never from the model;
 *  - attribution (first name, last initial) travels with the words whenever they are copied out.
 */

export type TranscriptEntry = { speaker: string; email: string | null; text: string; timestamp: string };
export type Located = { index: number; speaker: string; timestamp: string; contextBefore: string | null; contextAfter: string | null };

/** Whitespace and typographic quotes vary between a transcript and what a model echoes back; words never may. */
export function normalize(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, "...")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Where a verbatim quote starts in the transcript, with the speaker and time of that entry and a sentence either side. Null when it is not verbatim. */
export function locate(quote: string, entries: TranscriptEntry[]): Located | null {
  const q = normalize(quote);
  if (!q) return null;
  // Inside one entry first (the common case), then across consecutive entries of the same speaker.
  for (let i = 0; i < entries.length; i++) {
    if (normalize(entries[i].text).includes(q)) return at(i, entries);
  }
  for (let i = 0; i < entries.length; i++) {
    let joined = normalize(entries[i].text);
    for (let j = i + 1; j < entries.length && entries[j].speaker === entries[i].speaker; j++) {
      joined = `${joined} ${normalize(entries[j].text)}`;
      if (joined.includes(q)) return at(i, entries);
      if (joined.length > q.length * 3) break;
    }
  }
  return null;
}
function at(i: number, entries: TranscriptEntry[]): Located {
  return { index: i, speaker: entries[i].speaker, timestamp: entries[i].timestamp, contextBefore: entries[i - 1]?.text ?? null, contextAfter: entries[i + 1]?.text ?? null };
}
export const isVerbatim = (quote: string, entries: TranscriptEntry[]) => locate(quote, entries) !== null;

/** A trim keeps the quote's own words in order; "..." (or …) marks what was left out. Empty is not a trim. */
export function isTrim(short: string, quote: string): boolean {
  const q = normalize(quote);
  const pieces = normalize(short)
    .split(/\.\.\.|…/)
    .map((p) => p.replace(/^[\s"'.,;:!?-]+|[\s"'.,;:!?-]+$/g, ""))
    .filter(Boolean);
  if (!pieces.length) return false;
  let from = 0;
  for (const piece of pieces) {
    const i = q.indexOf(piece, from);
    if (i < 0) return false;
    from = i + piece.length;
  }
  return true;
}

/** The first `words` words of the quote, with an ellipsis when anything was left out. Always a trim. */
export function autoTrim(quote: string, words = 25): string {
  const ws = normalize(quote).split(" ");
  return ws.length <= words ? normalize(quote) : `${ws.slice(0, words).join(" ")}…`;
}

export function timestampSeconds(ts: string): number {
  const parts = ts.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
/** A link back to the moment, so the client can hear it in context before deciding. */
export function deepLink(shareUrl: string, timestamp: string): string {
  const sep = shareUrl.includes("?") ? "&" : "?";
  return `${shareUrl}${sep}timestamp=${timestampSeconds(timestamp)}`;
}

/** "Jess Morgan" → "Jess M."; a single name stays as it is. */
export function attribution(who: string | null | undefined): string {
  const parts = (who ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
/** The words and the name, as one string, so they are never separated by accident. */
export function withAttribution(text: string, who: string | null | undefined): string {
  const a = attribution(who);
  const t = text.replace(/\s+/g, " ").trim(); // their characters as they are; normalize() is for comparing, not for showing
  return a ? `“${t}” — ${a}` : `“${t}”`;
}

/** What the model may return. Anything else is ignored. */
export type ExtractedQuote = { quote: string; speaker?: string | null };
export function parseExtraction(text: string): ExtractedQuote[] {
  try {
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { quotes?: unknown };
    if (!Array.isArray(json.quotes)) return [];
    const out: ExtractedQuote[] = [];
    for (const q of json.quotes) {
      if (!q || typeof q !== "object" || typeof (q as { quote?: unknown }).quote !== "string") continue;
      const quote = (q as { quote: string }).quote;
      if (!quote.trim()) continue;
      const speaker = (q as { speaker?: unknown }).speaker;
      out.push({ quote, speaker: typeof speaker === "string" ? speaker : null });
    }
    return out;
  } catch {
    return [];
  }
}

export type HarvestedQuote = { quote: string; speaker: string; timestamp: string; contextBefore: string | null; contextAfter: string | null };
/** Keeps only what the transcript itself confirms; the dropped count is reported to the client, not hidden. */
export function verify(candidates: ExtractedQuote[], entries: TranscriptEntry[]): { kept: HarvestedQuote[]; dropped: number } {
  const kept: HarvestedQuote[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = normalize(c.quote);
    if (seen.has(key)) continue;
    seen.add(key);
    const loc = locate(c.quote, entries);
    if (!loc) {
      dropped++;
      continue;
    }
    kept.push({ quote: normalize(c.quote), speaker: loc.speaker, timestamp: loc.timestamp, contextBefore: loc.contextBefore, contextAfter: loc.contextAfter });
  }
  return { kept, dropped };
}

/** The transcript as the model sees it: one line per entry, with the speaker label and time it must quote from. */
export function transcriptText(entries: TranscriptEntry[]): string {
  return entries.map((e) => `[${e.timestamp}] ${e.speaker}: ${e.text}`).join("\n");
}
