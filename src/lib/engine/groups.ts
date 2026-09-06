/** Group-aligned posting: shape a post for someone else's community so it honors their mission, rules, and admin. */

export type GroupProfile = {
  name: string;
  kind: "own" | "member" | "prospect";
  mission?: string | null;
  description?: string | null;
  audience?: string | null;
  adminName?: string | null;
  adminValues?: string | null;
  rules?: string | null;
  postingNorms?: string | null;
  whatWorks?: string | null;
};

export type Source = { title: string; hook?: string | null; body?: string | null; hasCta?: boolean; firstName?: string | null };

export type AlignmentCheck = { key: string; label: string; ok: boolean; note: string };

const has = (s?: string | null, re?: RegExp) => Boolean(s && (re ? re.test(s) : s.trim().length > 0));

/** What the group's rules forbid or ask for, read from free text. */
export function readRules(g: GroupProfile) {
  const rules = `${g.rules ?? ""} ${g.postingNorms ?? ""}`.toLowerCase();
  return {
    noLinks: /no link|without link|links? (are )?not allowed|no external link|no url/.test(rules),
    noPromo: /no promo|no self[- ]promo|no selling|no pitch|no advertis|not a place to sell|no solicit/.test(rules),
    noDm: /no (cold )?dm|don'?t dm|do not (cold )?message/.test(rules),
    askFirst: /ask (the )?admin|admin approval|approval required|approved by/.test(rules),
    valueFirst: /value|help|give|contribute/.test(rules),
    promoDay: (rules.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)[^.]*promo|promo[^.]*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/) ?? [])[0] ?? null,
  };
}

function firstSentence(s?: string | null): string {
  const t = (s ?? "").trim().split(/\n/)[0] ?? "";
  return t.split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]$/, "") ?? "";
}

function themeOf(g: GroupProfile): string {
  const src = g.mission || g.description || g.audience || "";
  const t = firstSentence(src);
  return t.length > 8 ? t : "";
}

function stripLinks(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "[link removed per group rules]").replace(/\blink in (bio|comments?)\b/gi, "happy to share more if you ask");
}

/** Builds the group-aligned draft plus a pre-post checklist. Deterministic; Claude can polish on top. */
export function alignPost(src: Source, g: GroupProfile): { body: string; checks: AlignmentCheck[]; ctaAllowed: boolean } {
  const r = readRules(g);
  const own = g.kind === "own";
  const theme = themeOf(g);
  const hook = (src.hook ?? "").trim() || src.title;
  const lines = (src.body ?? "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const valuesLine = has(g.adminValues) ? firstSentence(g.adminValues) : "";
  const ctaAllowed = own || (!r.noPromo && Boolean(src.hasCta));

  const opener = own
    ? hook
    : theme
      ? `For everyone here working on ${theme.charAt(0).toLowerCase() + theme.slice(1).replace(/[.!]$/, "")}: ${hook.charAt(0).toLowerCase() + hook.slice(1)}`
      : hook;
  const close = own
    ? src.hasCta
      ? "Want the full version? Comment \"more\" and I'll send it."
      : "Your turn: where are you with this? Reply below."
    : ctaAllowed
      ? "If it's useful I can share the full breakdown. Just ask."
      : valuesLine
        ? `Sharing because this group is about ${valuesLine.charAt(0).toLowerCase() + valuesLine.slice(1).replace(/[.!]$/, "")}. What's your version of this?`
        : "Hope this helps someone here. What would you add?";
  const thanks = !own && g.adminName ? `\n\n(Thanks ${g.adminName.split(" ")[0]} for the space.)` : "";
  let body = [opener, "", ...lines.slice(0, 8), "", close].join("\n") + thanks;
  if (r.noLinks || !own) body = stripLinks(body);

  const checks: AlignmentCheck[] = [
    { key: "mission", label: "Matches the group's mission", ok: own || Boolean(theme), note: theme ? `Opens on: “${theme}”` : "Add the group's mission so the opener can reference it." },
    { key: "values", label: "Honors the admin's values", ok: own || has(g.adminValues), note: has(g.adminValues) ? `Closes in line with: “${valuesLine}”` : "Note what the admin cares about (what they praise, what they delete)." },
    { key: "links", label: r.noLinks ? "No links (group rule)" : "Links only if allowed", ok: !r.noLinks || !/https?:\/\//.test(body), note: r.noLinks ? "Links stripped from the draft." : "No link rule found. Still lead with value." },
    { key: "promo", label: r.noPromo ? "No pitch (group rule)" : "Pitch only where welcome", ok: !r.noPromo || !ctaAllowed, note: r.noPromo ? "CTA removed. Let people come to you." : own ? "Your group, your CTA." : "Soft CTA only." },
    { key: "norms", label: "Follows posting norms", ok: has(g.postingNorms) || own, note: has(g.postingNorms) ? g.postingNorms!.split(/\n/)[0] : "Add norms: best days, format, length, what gets removed." },
    { key: "works", label: "Uses what works here", ok: has(g.whatWorks) || own, note: has(g.whatWorks) ? g.whatWorks!.split(/\n/)[0] : "Note the 2 post types that get the most comments in this group." },
    ...(r.askFirst ? [{ key: "approval", label: "Admin approval required", ok: false, note: "This group asks for approval. Message the admin before posting." }] : []),
  ];
  return { body: body.slice(0, 1800), checks, ctaAllowed };
}

/** Scores how prepared a group profile is for aligned posting (0 to 100). */
export function groupReadiness(g: GroupProfile): number {
  const fields = [g.mission, g.description, g.audience, g.adminName, g.adminValues, g.rules, g.postingNorms, g.whatWorks];
  return Math.round((fields.filter((f) => has(f)).length / fields.length) * 100);
}
