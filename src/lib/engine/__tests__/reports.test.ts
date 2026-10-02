import { describe, expect, it } from "vitest";
import { newFeedbackCount, pagePath, readReport, reportScreenshotKey, sniffImage, timeOf } from "@/lib/engine/reports";

const base = { kind: "issue", severity: "red", description: "The Save button does nothing on my phone.", page: "/intentions", question: "", answer: "", talkToCoach: false };

describe("an issue or a suggestion (rev 432 items 2 and 3)", () => {
  it("an issue and a suggestion need words; a suggestion is green unless coloured", () => {
    expect(readReport(base)).toEqual({ value: { kind: "issue", severity: "red", description: "The Save button does nothing on my phone.", page: "/intentions", question: null, answer: null, talkToCoach: false } });
    expect(readReport({ ...base, description: "  " })).toMatchObject({ field: "description" });
    expect(readReport({ ...base, kind: "suggestion", severity: "", description: "A dark mode." })).toMatchObject({ value: { severity: "green" } });
    expect(readReport({ ...base, severity: "" })).toMatchObject({ field: "severity" });
    expect(readReport({ ...base, kind: "complaint" })).toMatchObject({ field: "kind" });
  });
  it("an Ask Danno answer needs the question and the answer; talking to the coach rides only on it", () => {
    expect(readReport({ ...base, kind: "ask_danno", description: "" })).toMatchObject({ field: "question" });
    expect(readReport({ ...base, kind: "ask_danno", question: "What's a ladder?", answer: "" })).toMatchObject({ field: "answer" });
    const ok = readReport({ ...base, kind: "ask_danno", severity: "orange", description: "", question: "What's a ladder?", answer: "A tool for painting.", talkToCoach: true });
    expect(ok).toMatchObject({ value: { kind: "ask_danno", question: "What's a ladder?", answer: "A tool for painting.", talkToCoach: true, description: "" } });
    expect(readReport({ ...base, talkToCoach: true })).toMatchObject({ value: { talkToCoach: false } });
  });
  it("the page is a path inside the app, its query dropped (it can carry a token)", () => {
    expect(pagePath("/reset/abc?token=secret")).toBe("/reset/abc");
    expect(pagePath("/webinars/123#deck")).toBe("/webinars/123");
    expect(pagePath("https://evil.example/x")).toBeNull();
    expect(pagePath("//evil.example")).toBeNull();
    expect(pagePath("")).toBeNull();
  });
});

describe("the screenshot", () => {
  it("is an image by its bytes, never by its name", () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ mime: "image/png", ext: "png" });
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ mime: "image/jpeg", ext: "jpg" });
    expect(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toEqual({ mime: "image/webp", ext: "webp" });
    expect(sniffImage(new TextEncoder().encode("GIF89a"))).toEqual({ mime: "image/gif", ext: "gif" });
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
  });
  it("lives in its own tree, outside the proofs and deck trees the sweeps reconcile", () => {
    expect(reportScreenshotKey("ws1", "r1", "png")).toBe("reports/ws1/r1.png");
  });
});

describe("new monthly feedback for the coach (rev 432 item 4)", () => {
  it("counts what was sent or changed since the coach last looked, whichever way the time was written", () => {
    const rows = [
      { createdAt: "2026-10-01 09:00:00", updatedAt: "2026-10-01 09:00:00" },
      { createdAt: "2026-09-30 09:00:00", updatedAt: "2026-10-02T10:00:00.000Z" },
      { createdAt: "2026-09-29 09:00:00", updatedAt: "2026-09-29 09:00:00" },
    ];
    expect(newFeedbackCount(rows, null)).toBe(3);
    expect(newFeedbackCount(rows, "2026-09-30T12:00:00.000Z")).toBe(2);
    expect(newFeedbackCount(rows, "2026-10-02T12:00:00.000Z")).toBe(0);
    expect(timeOf("2026-10-01 09:00:00")).toBe(Date.parse("2026-10-01T09:00:00Z"));
    expect(timeOf(null)).toBe(0);
  });
});
