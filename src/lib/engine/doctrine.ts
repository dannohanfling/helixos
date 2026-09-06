/** Turns a principle into content: a post, a reel script, a 10-minute training outline. Rule-based so it works offline. */

export type PrincipleLike = {
  code: string;
  symbol?: string | null;
  greekName?: string | null;
  name: string;
  summary?: string | null;
  doctrine?: string | null;
  greekStory?: string | null;
  businessCase?: string | null;
  publicFigureStory?: string | null;
  reelScript?: string | null;
  trainingOutline?: string | null;
  salesPositioning?: string | null;
};

const para = (s?: string | null) => (s ?? "").trim().split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

export function principlePost(p: PrincipleLike, voiceName = "me"): string {
  const story = para(p.publicFigureStory).slice(0, 3).join("\n\n") || para(p.businessCase).slice(0, 3).join("\n\n") || para(p.greekStory).slice(0, 3).join("\n\n");
  const lesson = para(p.summary)[0] ?? para(p.doctrine)[0] ?? "";
  return [
    `${p.name}.`,
    "",
    story || lesson,
    "",
    story && lesson && !story.includes(lesson) ? lesson : "",
    "",
    `This is ${p.symbol ?? "Ω"} ${p.greekName ? `${p.greekName}. ` : ""}${p.name}. One of the principles I run my business on.`,
    "",
    "Where are you seeing this play out right now?",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n")
    .trim()
    .replace(/\{voice\}/g, voiceName);
}

export function principleReel(p: PrincipleLike): string {
  if (p.reelScript) return p.reelScript;
  const lesson = para(p.summary)[0] ?? para(p.doctrine)[0] ?? p.name;
  const proof = para(p.businessCase)[0] ?? para(p.publicFigureStory)[0] ?? para(p.greekStory)[0] ?? "";
  return [
    `HOOK (0–3s): "${p.name}." Say it flat. Pause.`,
    `PROBLEM (3–15s): Most people get this backwards. ${lesson.split(/(?<=[.!?])\s/)[0]}`,
    `PROOF (15–40s): ${proof.split(/(?<=[.!?])\s/).slice(0, 2).join(" ")}`,
    `SHIFT (40–52s): ${lesson}`,
    `CTA (52–60s): If you want the whole principle, comment "${(p.greekName ?? p.name).split(" ")[0].toUpperCase()}" and I'll send it.`,
  ].join("\n\n");
}

export function principleTraining(p: PrincipleLike): string {
  if (p.trainingOutline) return p.trainingOutline;
  return [
    `1. Name it (1 min): ${p.symbol ?? ""} ${p.greekName ?? ""} — ${p.name}.`,
    `2. The old belief (2 min): what everyone assumes, and why it feels true.`,
    `3. The doctrine (3 min): ${para(p.doctrine)[0] ?? para(p.summary)[0] ?? ""}`,
    `4. The story (2 min): ${para(p.greekStory)[0] ?? para(p.businessCase)[0] ?? para(p.publicFigureStory)[0] ?? "Your own story of this principle."}`,
    `5. The move (2 min): one thing they do this week to live it. Then a question to the room.`,
  ].join("\n");
}
