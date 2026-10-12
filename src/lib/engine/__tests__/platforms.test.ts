import { describe, expect, it } from "vitest";
import { PLATFORMS, cleanPlatformLink, platformHref } from "@/lib/platforms";
import { withPlatformLinks } from "@/components/nav-groups";

describe("the Platforms links are the coach's to set (rev 843)", () => {
  it("keeps only an https address with a real host", () => {
    expect(cleanPlatformLink("https://learn.example.com/c")).toBe("https://learn.example.com/c");
    expect(cleanPlatformLink(" https://x.io ")).toBe("https://x.io/");
    expect(cleanPlatformLink("http://x.io")).toBeNull();
    expect(cleanPlatformLink("javascript:alert(1)")).toBeNull();
    expect(cleanPlatformLink("https://localhost")).toBeNull();
    expect(cleanPlatformLink("")).toBeNull();
    expect(cleanPlatformLink(`https://x.io/${"a".repeat(300)}`)).toBeNull();
  });
  it("a set link wins over the default; a member's own community wins over the coach's; Community hides until it has one", () => {
    expect(platformHref("academy", {})).toBe("https://academy.evolveomega.com");
    expect(platformHref("academy", { academy: "https://learn.example.com" })).toBe("https://learn.example.com/");
    expect(platformHref("community", {})).toBe("");
    expect(platformHref("community", { community: "https://c.example.com" }, "https://mine.example.com")).toBe("https://mine.example.com/");
    const items = PLATFORMS.map((p) => ({ href: p.href, label: p.label, icon: p.icon, external: true, platformKey: p.key }));
    expect(withPlatformLinks(items, {}).map((n) => n.label)).not.toContain("Community");
    expect(withPlatformLinks(items, { community: "https://c.example.com" }).find((n) => n.label === "Community")?.href).toBe("https://c.example.com/");
  });
});
