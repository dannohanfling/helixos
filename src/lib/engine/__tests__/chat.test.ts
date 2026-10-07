import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_CHANNELS } from "@/db/schema";
import { CHANNEL_LABELS, DAILY_CAP, LINK_MESSAGES, LINK_TTL_MS, PROGRESS_KEYS, WARN_AT, goalLine, identifierHash, isChatChannel, isFlowNs, isWidgetId, linkState, mainOfferName, progressPayload, week313Line, widgetSrc, withinPushGap } from "../chat";

const SRC = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

describe("Community Loyalty chat (revs 241, 243, 247): the pure parts", () => {
  it("the identifier hash is HMAC-SHA256 of the user id under the secret, hex, and changes with either", () => {
    // A known vector: HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog").
    expect(identifierHash("The quick brown fox jumps over the lazy dog", "key")).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
    expect(identifierHash("u1", "s")).not.toBe(identifierHash("u2", "s"));
    expect(identifierHash("u1", "s")).not.toBe(identifierHash("u1", "t"));
  });

  it("chat channels only: email and SMS run through GoHighLevel, never here", () => {
    expect([...CHAT_CHANNELS]).toEqual(["messenger", "instagram", "whatsapp", "telegram", "webchat"]);
    expect(isChatChannel("email")).toBe(false);
    expect(isChatChannel("sms")).toBe(false);
    expect(isChatChannel("messenger")).toBe(true);
    for (const c of CHAT_CHANNELS) expect(CHANNEL_LABELS[c]).toBeTruthy();
  });

  it("a widget id or sub flow id is letters and digits, or it never reaches a script tag", () => {
    expect(isWidgetId("abc123widget")).toBe(true);
    expect(isWidgetId("../evil")).toBe(false);
    expect(isWidgetId("abc")).toBe(false);
    expect(widgetSrc("walkwidget1")).toBe("https://communityloyalty.io/js/widget/walkwidget1/float.js");
    expect(isFlowNs("f52594s4788801")).toBe(true);
    expect(isFlowNs("f5?x")).toBe(false);
  });

  it("a link is good once, for ten minutes, in its own workspace, and each refusal has plain words", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    const row = { workspaceId: "ws", usedAt: null, expiresAt: new Date(now + 60_000).toISOString() };
    expect(LINK_TTL_MS).toBe(10 * 60 * 1000);
    expect(linkState(row, "ws", now)).toBe("ok");
    expect(linkState({ ...row, expiresAt: new Date(now - 1).toISOString() }, "ws", now)).toBe("expired");
    expect(linkState({ ...row, usedAt: "2026-09-30T11:59:00Z" }, "ws", now)).toBe("used");
    expect(linkState(row, "other", now)).toBe("wrong_workspace");
    // Wrong workspace wins over used: a link for another account says so before anything about its state.
    expect(linkState({ ...row, usedAt: "x" }, "other", now)).toBe("wrong_workspace");
    for (const k of ["expired", "used", "wrong_workspace"] as const) expect(LINK_MESSAGES[k]).toMatch(/link/);
  });
});

describe("Community Loyalty chat: the secret stays on the server", () => {
  it("no client component reads the chat secret or the webhook URL, and the widget gets only the hash", () => {
    const dir = join(SRC, "components");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const text = readFileSync(join(dir, f), "utf8");
      if (!text.startsWith('"use client"')) continue;
      expect(text, f).not.toMatch(/chatSecret|chatWebhookUrl|@\/lib\/crypto/);
    }
    const widget = read("components/chat-widget.tsx");
    expect(widget).toMatch(/identifier_hash: hash/);
    expect(widget).not.toMatch(/createHmac/);
    // Rev 270: never before the SDK says it has loaded; at once if it already has; and a visible, non-secret signal once called.
    expect(widget).toMatch(/if \(why !== "ready" && !bot\.hasLoaded\) return false;/);
    expect(widget).toMatch(/window\.addEventListener\("chatbot:ready", onReady\)/);
    expect(widget).toMatch(/setAttribute\("data-chat-identified", "true"\)/);
    // The hash is hex over the very string passed as the id.
    expect(read("lib/engine/chat.ts")).toMatch(/createHmac\("sha256", secret\)\.update\(userId, "utf8"\)\.digest\("hex"\)/);
    expect(read("lib/chat.ts")).toMatch(/userId: v\.user\.id, name: v\.user\.name, email: v\.user\.email\.toLowerCase\(\), hash: identifierHash\(v\.user\.id, c\.secret\)/);
  });

  it("the widget never loads while a coach is switched into a client, and the hash is computed on the server per render", () => {
    const chat = read("lib/chat.ts");
    expect(chat).toMatch(/if \(v\.switchedInto \|\| v\.team\) return null;/);
    expect(chat).toMatch(/hash: identifierHash\(v\.user\.id, c\.secret\)/);
    expect(read("app/(app)/layout.tsx")).toMatch(/chatWidgetProps\(viewer\)/);
  });

  it("the sync log gets the event and the channel or reason, never the email or the URL", () => {
    const chat = read("lib/chat.ts");
    expect(chat).toMatch(/const logged = \{ event: payload\.event, \.\.\.\(payload\.channel \? \{ channel: payload\.channel \} : \{\}\), \.\.\.\(payload\.reason \? \{ reason: payload\.reason \} : \{\}\) \};/);
    expect(chat).not.toMatch(/payload: payload/);
  });

  it("the start endpoint takes the secret as a header only, and answers with a link, never a secret", () => {
    const route = read("app/api/chat-link/start/route.ts");
    expect(route).toMatch(/x-helix-secret/);
    expect(route).toMatch(/not in the URL/);
    expect(route).toMatch(/NextResponse\.json\(\{ url: link\.url, expires_at: link\.expiresAt \}\)/);
    // Public to the proxy, since the bot has no session; the CSP report endpoint too.
    expect(read("proxy.ts")).toMatch(/"\/api\/chat-link", "\/api\/csp-report"/);
  });

  it("the Content-Security-Policy names the widget's host, not the web, and reports what it blocks", () => {
    const cfg = readFileSync(join(SRC, "..", "next.config.ts"), "utf8");
    expect(cfg).toMatch(/const chatHosts = "https:\/\/communityloyalty\.io https:\/\/\*\.communityloyalty\.io";/);
    // The widget's own SDK and geo lookup (rev 266): script and connections from both, the chat frame from the SDK host only.
    expect(cfg).toMatch(/const chatSdkHosts = "https:\/\/sdk\.dfktv2\.com https:\/\/ipapi\.co";/);
    expect(cfg).toMatch(/const chatFrameHosts = "https:\/\/sdk\.dfktv2\.com";/);
    expect(cfg).toMatch(/script-src[^\n]*\$\{chatSdkHosts\}/);
    expect(cfg).toMatch(/connect-src[^\n]*\$\{chatSdkHosts\}/);
    expect(cfg).toMatch(/frame-src 'self' \$\{chatHosts\} \$\{chatFrameHosts\}/);
    expect(cfg).not.toMatch(/frame-src[^\n]*ipapi/);
    expect(cfg).toMatch(/report-uri \/api\/csp-report/);
    expect(cfg).not.toMatch(/script-src[^\n]*https:\s/);
  });
});

describe("Community Loyalty chat: progress pushes (rev 247, addition 2)", () => {
  it("the payload has exactly the promised keys, whatever the caller holds; email lowercased; empty for what is unset", () => {
    // A member with everything: the builder takes named fields only, so none of this can ride along.
    const everything = { email: "Client@Example.com", name: "Maya Chen", pathwayStage: "Stage 2: Offer", goal: "Cash: $5,000, this month", week313: null, mainOffer: null, reason: "goal_changed" as const, at: "2026-09-30T10:00:00Z", bodyTargets: { p: 180 }, apiKey: "sk-nope", notes: "private" };
    const p = progressPayload(everything);
    expect(Object.keys(p).sort()).toEqual([...PROGRESS_KEYS].sort());
    expect(p.email).toBe("client@example.com");
    expect(p.week_313).toBe("");
    expect(p.main_offer).toBe("");
    expect(JSON.stringify(p)).not.toMatch(/sk-nope|private|180/);
    expect(PROGRESS_KEYS).toEqual(["event", "email", "name", "pathway_stage", "goal", "week_313", "main_offer", "reason", "at"]);
  });

  it("one push an hour per member, and the platform's daily cap with a warning before it", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    expect(withinPushGap(null, now)).toBe(false);
    expect(withinPushGap("2026-09-30T11:30:00Z", now)).toBe(true);
    expect(withinPushGap("2026-09-30T10:59:00Z", now)).toBe(false);
    expect(DAILY_CAP).toBe(500);
    expect(WARN_AT).toBe(400);
  });

  it("the main offer is the one on the bot (core, else entry), else the newest live one, by the bot's short name when set", () => {
    const base = { botName: null, status: "draft", createdAt: "2026-01-01" };
    expect(mainOfferName([])).toBeNull();
    expect(mainOfferName([{ ...base, name: "Old", botRole: "not_on_bot", status: "live" }, { ...base, name: "Entry", botRole: "entry" }, { ...base, name: "Academy", botRole: "core", botName: "The Academy" }])).toBe("The Academy");
    expect(mainOfferName([{ ...base, name: "Entry", botRole: "entry" }, { ...base, name: "Live", botRole: "not_on_bot", status: "live" }])).toBe("Entry");
    expect(mainOfferName([{ ...base, name: "Older live", botRole: "not_on_bot", status: "live", createdAt: "2026-01-01" }, { ...base, name: "Newer live", botRole: "not_on_bot", status: "live", createdAt: "2026-02-01" }, { ...base, name: "Draft", botRole: "not_on_bot" }])).toBe("Newer live");
  });

  it("the goal and the 3-1-3 read as one line each, the 3-1-3 capped", () => {
    expect(goalLine({ title: "Cash collected", target: 5000, unit: "$", period: "This month" })).toBe("Cash collected: $5,000, this month");
    expect(goalLine({ title: "Calls", target: 20, unit: "calls", period: "This week" })).toBe("Calls: 20 calls, this week");
    expect(goalLine(null)).toBeNull();
    expect(week313Line({ word: "Focus", keyResults: [{ text: "3 posts" }, { text: "1 webinar" }], initiative: "Launch", tasks: [{ title: "Write" }] })).toBe("Word: Focus. Key results: 3 posts; 1 webinar. Initiative: Launch. Tasks: Write.");
    expect(week313Line({ word: "", keyResults: [{ text: "x".repeat(700) }], initiative: "", tasks: [] })!.length).toBe(600);
  });

  it("every event the brief names queues a push, and the first sign-in only once", () => {
    expect(read("lib/actions/intentions.ts")).toMatch(/queueProgress\(workspaceId, userId, "intention_set"\)/);
    expect(read("lib/actions/pathway.ts")).toMatch(/queueProgress\(row\.workspaceId, row\.userId, "pathway_verified"\)/);
    expect(read("lib/actions/settings.ts")).toMatch(/queueProgress\(workspaceId, userId, "goal_changed"\)/);
    expect((read("lib/actions/offers.ts").match(/queueProgress\(workspaceId, userId, "offer_changed"\)/g) ?? []).length).toBe(2);
    const gate = read("lib/email-gate.ts");
    expect(gate).toMatch(/returning\(\{ id: schema\.users\.id \}\)/);
    expect(gate).toMatch(/if \(!first\.length\) return;/);
    expect(gate).toMatch(/queueProgress\(m\.workspaceId, userId, "first_sign_in"\)/);
    // The member's switch, the gap and the cap are checked before anything is read or sent.
    const push = read("lib/chat-progress.ts");
    expect(push.indexOf("if (!m.chatProgressShare) return")).toBeLessThan(push.indexOf("progressSnapshot(workspaceId, userId)"));
    expect(push.indexOf("withinPushGap(m.lastChatPushAt")).toBeLessThan(push.indexOf("progressSnapshot(workspaceId, userId)"));
    expect(push.indexOf(">= DAILY_CAP")).toBeLessThan(push.indexOf("progressSnapshot(workspaceId, userId)"));
  });
});
