import { describe, expect, it } from "vitest";
import { NO_IDENTITY_NOTE, PUSHING_STAGES, identityOf, pushedNote, pushesAt, stageNeedsIdentity } from "../contact-sync";
import { redactSecrets } from "../redact";

describe("the identity a push needs", () => {
  it("an email or a phone is an identity; a chatbot id is one; a name alone is not", () => {
    expect(identityOf({ email: "a@b.c" })).toBe("email-or-phone");
    expect(identityOf({ phone: " +1 555 " })).toBe("email-or-phone");
    expect(identityOf({ userNs: "ns_123" })).toBe("user-ns");
    expect(identityOf({ email: " ", phone: null, userNs: "" })).toBeNull();
    expect(identityOf({})).toBeNull();
  });
  it("the stages that push, and what the refusal says", () => {
    expect([...PUSHING_STAGES]).toEqual(["call_booked", "client"]);
    expect(pushesAt("replied")).toBe(false);
    expect(stageNeedsIdentity("call_booked")).toBe("Add an email or phone before marking the call booked: that is what GoHighLevel matches on.");
    expect(stageNeedsIdentity("client")).toBe("Add an email or phone before marking them a client: that is what GoHighLevel matches on.");
    expect(NO_IDENTITY_NOTE).toBe("No email or phone to sync this contact with. Add one on the contact.");
  });
  it("the sync log says whether GoHighLevel linked or created, from its own answer", () => {
    expect(pushedNote({ id: "c1", isNew: true }, "loc")).toBe("Created a new contact c1 in loc");
    expect(pushedNote({ id: "c1", isNew: false }, "loc")).toBe("Linked to an existing contact c1 in loc");
    expect(pushedNote({ id: "c1", isNew: null }, "loc")).toBe("Contact c1 updated in loc");
  });
});

describe("nothing token-shaped reaches a log or a note", () => {
  it("a Private Integration token, a bearer value, a JWT and a long base64 run are redacted; ordinary words are not", () => {
    expect(redactSecrets("bad token pit-1234567890abcdef in body")).toBe("bad token pit-[redacted] in body");
    expect(redactSecrets("Authorization: Bearer abcDEF123456789")).toBe("Authorization: Bearer [redacted]");
    expect(redactSecrets("got eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop")).toBe("got [jwt redacted]");
    expect(redactSecrets("key " + "A".repeat(48))).toBe("key [redacted]");
    expect(redactSecrets("The token does not have access to this scope: socialplanner/post.write")).toBe("The token does not have access to this scope: socialplanner/post.write");
    expect(redactSecrets("Location not found: loc_maya")).toBe("Location not found: loc_maya");
  });
});
