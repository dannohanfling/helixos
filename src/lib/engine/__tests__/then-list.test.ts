import { describe, expect, it } from "vitest";
import { thenItems } from "../then-list";

const today = "2026-10-19";
const empty = { today, tasks: [], content: [], inbound: [], followUps: [], upcoming: [] };

describe("Today's Then list (H-164 §14)", () => {
  it("puts overdue first, then today's by time, untimed after timed, then the week ahead", () => {
    const items = thenItems({
      ...empty,
      tasks: [{ id: "t-today", dueDate: today }, { id: "t-late", dueDate: "2026-10-17" }],
      content: [{ id: "c-3pm", postAt: `${today}T15:00` }, { id: "c-9am", postAt: `${today}T09:00` }],
      upcoming: [{ id: "u-thu", dueDate: "2026-10-22" }],
      followUps: [{ id: "f", nextFollowUpAt: "2026-10-18" }],
    });
    expect(items.map((i) => i.key)).toEqual(["task:t-late", "follow:f", "content:c-9am", "content:c-3pm", "task:t-today", "soon:u-thu"]);
    expect(items.filter((i) => i.late).map((i) => i.id)).toEqual(["t-late", "f"]);
  });

  it("shows a contact once, as a reply, when they replied and are also due a follow-up", () => {
    const items = thenItems({ ...empty, inbound: [{ id: "x", lastInboundAt: `${today}T08:30:00.000Z` }], followUps: [{ id: "x", nextFollowUpAt: today }] });
    expect(items.map((i) => i.key)).toEqual(["reply:x"]);
  });

  it("never lists a task twice when it is both due and in the week ahead", () => {
    const items = thenItems({ ...empty, tasks: [{ id: "t", dueDate: today }], upcoming: [{ id: "t", dueDate: today }] });
    expect(items).toHaveLength(1);
  });

  it("orders kinds at the same moment: someone waiting, then a post, then a task", () => {
    const items = thenItems({ ...empty, tasks: [{ id: "t", dueDate: today }], content: [{ id: "c", postAt: today }], inbound: [{ id: "r", lastInboundAt: today }] });
    expect(items.map((i) => i.kind)).toEqual(["reply", "content", "task"]);
  });

  it("is empty when nothing is due", () => {
    expect(thenItems(empty)).toEqual([]);
  });
});
