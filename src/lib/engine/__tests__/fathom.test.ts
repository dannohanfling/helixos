import { describe, expect, it } from "vitest";
import { attribution, autoTrim, deepLink, isTrim, locate, parseExtraction, timestampSeconds, verify, withAttribution, type TranscriptEntry } from "../fathom";

const entries: TranscriptEntry[] = [
  { speaker: "Maya Torres", email: "m@x", text: "So tell me how the last month has actually gone.", timestamp: "00:12:04" },
  { speaker: "Jess Morgan", email: "j@x", text: "Honestly it's been different. I've had three new clients this month and I didn't chase a single one.", timestamp: "00:12:19" },
  { speaker: "Jess Morgan", email: "j@x", text: "Before this I was posting every day and getting nothing back.", timestamp: "00:12:31" },
  { speaker: "Maya Torres", email: "m@x", text: "What changed, do you think?", timestamp: "00:12:40" },
];

describe("a quote is verbatim or it does not exist", () => {
  it("finds a word-for-word quote and takes the speaker, time and context from the transcript, not the model", () => {
    const loc = locate("I've had three new clients this month and I didn't chase a single one.", entries)!;
    expect(loc.speaker).toBe("Jess Morgan");
    expect(loc.timestamp).toBe("00:12:19");
    expect(loc.contextBefore).toMatch(/last month/);
    expect(loc.contextAfter).toMatch(/posting every day/);
  });
  it("tolerates curly quotes and spacing but not a changed word", () => {
    expect(locate("I’ve had three new clients this month  and I didn’t chase a single one.", entries)).not.toBeNull();
    expect(locate("I've had three new clients this month and I never chased a single one.", entries)).toBeNull();
    expect(locate("This program changed my life completely.", entries)).toBeNull();
  });
  it("follows a quote across two consecutive entries by the same speaker, and not across speakers", () => {
    expect(locate("chase a single one. Before this I was posting every day", entries)?.timestamp).toBe("00:12:19");
    expect(locate("getting nothing back. What changed, do you think?", entries)).toBeNull();
  });
  it("keeps only what the transcript confirms and counts the rest as dropped", () => {
    const { kept, dropped } = verify([{ quote: "I've had three new clients this month and I didn't chase a single one.", speaker: "Someone Else" }, { quote: "This program changed my life completely." }, { quote: "I've had three new clients this month and I didn't chase a single one." }], entries);
    expect(kept).toHaveLength(1);
    expect(kept[0].speaker).toBe("Jess Morgan");
    expect(dropped).toBe(1);
  });
  it("reads the model's answer defensively", () => {
    expect(parseExtraction('Here you go: {"quotes":[{"quote":"a","speaker":"b"},{"nope":1},{"quote":""}]}')).toEqual([{ quote: "a", speaker: "b" }]);
    expect(parseExtraction("no json")).toEqual([]);
  });
});

describe("a shape is a trim, never a rewrite", () => {
  const quote = "Honestly it's been different. I've had three new clients this month and I didn't chase a single one.";
  it("accepts excerpts with an ellipsis for the gap, in order", () => {
    expect(isTrim("I've had three new clients this month… didn't chase a single one.", quote)).toBe(true);
    expect(isTrim("three new clients this month", quote)).toBe(true);
    expect(isTrim("Honestly it's been different.", quote)).toBe(true);
  });
  it("refuses a rewrite, a reordering and an empty string", () => {
    expect(isTrim("I got three new clients without chasing anyone.", quote)).toBe(false);
    expect(isTrim("didn't chase a single one… three new clients", quote)).toBe(false);
    expect(isTrim("…", quote)).toBe(false);
  });
  it("auto-trims to the first words with an ellipsis, which is itself a trim", () => {
    const short = autoTrim(quote, 6);
    expect(short).toBe("Honestly it's been different. I've had…");
    expect(isTrim(short, quote)).toBe(true);
    expect(autoTrim("Short one.", 25)).toBe("Short one.");
  });
});

describe("attribution travels with the words", () => {
  it("first name and last initial", () => {
    expect(attribution("Jess Morgan")).toBe("Jess M.");
    expect(attribution("Jess")).toBe("Jess");
    expect(attribution("  ")).toBe("");
    expect(withAttribution("three new clients this month", "Jess Morgan")).toBe("“three new clients this month” — Jess M.");
  });
  it("links back to the second in the recording", () => {
    expect(timestampSeconds("00:12:19")).toBe(739);
    expect(deepLink("https://fathom.video/share/abc", "00:12:19")).toBe("https://fathom.video/share/abc?timestamp=739");
    expect(deepLink("https://fathom.video/share/abc?x=1", "01:00:00")).toBe("https://fathom.video/share/abc?x=1&timestamp=3600");
  });
});
