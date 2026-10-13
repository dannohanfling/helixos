import { describe, expect, it } from "vitest";
import { GLOSSARY_SEED } from "@/content/glossary";
import { glossarySections, glossarySlug, glossaryWords, mergeGlossary } from "../glossary";

describe("Building with AI: the words (rev 768)", () => {
  it("seeds rev 768's entries word for word under its four headings, each with its own #link", () => {
    expect(GLOSSARY_SEED.map((s) => s.heading)).toEqual(["How a change gets built", "Saving and going live", "Keys and connections", "Working with AI agents"]);
    const all = GLOSSARY_SEED.flatMap((s) => s.entries);
    expect(all).toHaveLength(27);
    expect(new Set(all.map((e) => e.slug)).size).toBe(27);
    expect(all.find((e) => e.slug === "api-key")?.meaning).toBe("a secret password one service uses to talk to another. Never paste one into a chat, a document or a post. Only paste it into the settings field made for it.");
    expect(JSON.stringify(GLOSSARY_SEED)).not.toContain("—");
  });
  it("a coach's edit, hide or new word sits on top of the seed; members see visible ones only", () => {
    const items = mergeGlossary([
      { slug: "bug", heading: "How a change gets built", term: "Bug", meaning: "Something broken.", hidden: false },
      { slug: "tokens", heading: "Working with AI agents", term: "Tokens", meaning: "x", hidden: true },
      { slug: "cursor", heading: "Working with AI agents", term: "Cursor", meaning: "An editor with an agent in it.", hidden: false },
    ]);
    expect(items.find((i) => i.slug === "bug")).toMatchObject({ meaning: "Something broken.", edited: true });
    const sections = glossarySections(items);
    const words = sections.flatMap((s) => s.entries.map((e) => e.slug));
    expect(words).not.toContain("tokens");
    expect(words).toContain("cursor");
    expect(words).toHaveLength(27);
  });
  it("a new word's link never clashes, and the words an entry is found by include its short form", () => {
    expect(glossarySlug("Bug", new Set(["bug"]))).toBe("bug-2");
    expect(glossarySlug("Pull request (PR)", new Set())).toBe("pull-request");
    expect(glossaryWords("Repository (repo)")).toEqual(["Repository", "repo"]);
    expect(glossaryWords("The gate (tests)")).toEqual(["gate", "tests"]);
  });
});
