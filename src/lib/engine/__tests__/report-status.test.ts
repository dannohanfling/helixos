import { describe, expect, it } from "vitest";
import { HOW_BLANK, REASON_BLANK, firstName, readReply, receiptLine, replyText, topicOf } from "@/lib/engine/report-status";

describe("report statuses that tell the member (H-202)", () => {
  it("prefills Danno's four replies with the first name and the topic", () => {
    const v = { first: "Maya", topic: "the GoHighLevel connection" };
    expect(replyText("seen", v)).toBe("Thanks, Maya. I've got your note about the GoHighLevel connection and I'm on it.");
    expect(replyText("working", v)).toBe("Quick update: we're fixing the GoHighLevel connection now. I'll let you know when it's live.");
    expect(replyText("done", v)).toBe(`Done: the GoHighLevel connection is fixed. ${HOW_BLANK}. Thanks for flagging it!`);
    expect(replyText("not_now", v)).toBe(`Thanks for the idea about the GoHighLevel connection. We're holding it for now because ${REASON_BLANK}.`);
  });

  it("refuses Done and Not now until the blank is filled, and an empty message always", () => {
    expect(readReply("done", replyText("done", { first: "M", topic: "x" }))).toEqual({ error: expect.stringMatching(/how it was fixed/) });
    expect(readReply("not_now", replyText("not_now", { first: "M", topic: "x" }))).toEqual({ error: expect.stringMatching(/reason/) });
    expect(readReply("not_now", "We're holding it for now because")).toEqual({ error: expect.stringMatching(/reason/) });
    expect(readReply("seen", "   ")).toEqual({ error: "Write the message first." });
    expect(readReply("done", "Done: x is fixed. It reconnects on its own now. Thanks!")).toEqual({ text: "Done: x is fixed. It reconnects on its own now. Thanks!" });
  });

  it("reads a topic of 3 to 6 words from the member's words, unless the coach set one", () => {
    expect(topicOf({ topic: null, description: "GoHighLevel still not connecting after I paste the key.", question: null })).toBe("GoHighLevel still not connecting after I");
    expect(topicOf({ topic: "  the GHL key  ", description: "anything", question: null })).toBe("the GHL key");
    expect(topicOf({ topic: null, description: "", question: "What should I post today?" })).toBe("What should I post today");
    expect(topicOf({ topic: null, description: "", question: null })).toBe("your note");
  });

  it("the receipt and the first name", () => {
    expect(receiptLine("Danno")).toBe("Got it, Danno will see this soon.");
    expect(firstName("Maya Torres")).toBe("Maya");
    expect(firstName("")).toBe("there");
  });
});
