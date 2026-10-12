/**
 * Bot connection's server (rev 696): /api/bot-mcp, separate from the member connector at /api/mcp. A member's Community
 * Loyalty bot sends its key as a Bearer token; the key alone says whose bot it is. Stateless, one message per request, like the
 * member connector. Exactly seven tools, all scoped to that one member; the limits are checked before a call runs and answered
 * with a 429 and a line the bot can say. Each call is logged as the tool, the member and the outcome: never what was said or
 * who said it.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { allow } from "@/lib/rate-limit";
import { logSync } from "@/lib/integrations";
import { APP_VERSION } from "@/lib/version";
import { BOT_STAGES, BUSY_LINE, LIMITS, MAX, cleanCustom, cleanText, isContactId, isEmail, isTimezone, isWrite, type BotTool } from "@/lib/engine/bot-mcp";
import { after } from "next/server";
import { mfPrepare, writeForSignup } from "@/lib/mf/data";
import { MF_MAX, cleanFirstName, cleanPhone } from "@/lib/engine/magic-funnel";
import { bookingInfo, faqAnswer, leadLog, memberForKey, offerInfo, touchKey, webinarNext, webinarRegister, type BotMember } from "@/lib/bot-mcp/data";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });
/** A stranger's text field: refused when too long, then cleaned. */
const field = (max: number) => z.string().max(max * 2).transform(cleanText).pipe(z.string().max(max));

type Result = { content: { type: "text"; text: string }[]; isError: boolean };

async function logged(m: BotMember, tool: BotTool, outcome: string, ok: boolean) {
  await logSync({ workspaceId: m.workspaceId, userId: m.userId, provider: "community_loyalty", direction: "in", event: `bot_mcp:${tool}`, payload: {}, status: ok ? "received" : "failed", note: outcome });
}

function tools(m: BotMember): { name: BotTool; description: string; input: z.ZodRawShape; write: boolean; run: (a: Record<string, unknown>) => Promise<Result> }[] {
  return [
    {
      name: "offer_info",
      write: false,
      description: "The business's offers the bot may talk about, the main one first: name, promise, who it's for and what it comes as. A price only where the owner allows prices; otherwise the owner's own answer about price, with no numbers.",
      input: {},
      run: async () => {
        const offers = await offerInfo(m);
        return text(offers.length ? JSON.stringify({ offers }) : "No offers are set up for the bot yet.");
      },
    },
    {
      name: "faq_answer",
      write: false,
      description: "Answers from the business's own FAQ that match a question: up to three, best first. Say only what they say.",
      input: { question: field(MAX.question).describe("The question, in the person's words.") },
      run: async (a) => {
        const found = await faqAnswer(m, String(a.question));
        return text(found.length ? JSON.stringify({ answers: found }) : "Nothing in the FAQ matches that question.");
      },
    },
    {
      name: "booking_info",
      write: false,
      description: "How to book a call: the booking link, what to expect when you book, and how long the call is.",
      input: {},
      run: async () => {
        const b = bookingInfo(m);
        return text(b.booking_link || b.what_to_expect ? JSON.stringify(b) : "No booking link is set up yet.");
      },
    },
    {
      name: "webinar_next",
      write: false,
      description: "The next upcoming webinar: its title, date and time, and its registration link. Give the person's time zone (like America/New_York) to get the time in theirs.",
      input: { timezone: z.string().max(MAX.timezone).optional().describe("The person's IANA time zone, if known.") },
      run: async (a) => {
        const tz = typeof a.timezone === "string" && isTimezone(a.timezone) ? a.timezone : null;
        const w = await webinarNext(m, tz);
        return text(w ? JSON.stringify(w) : "There's no webinar scheduled right now.");
      },
    },
    {
      name: "lead_log",
      write: true,
      description: "Adds or updates the person in this conversation in the business's DMs, by their Community Loyalty contact id. Stage: new, qualified, booked (with booked_on, the call's date) or no_show. Replies only \"logged\" or \"updated\"; it never reads anyone.",
      input: {
        contact_id: z.string().max(MAX.contactId).describe("The Community Loyalty contact id of the person in this conversation."),
        first_name: field(MAX.name),
        channel: field(MAX.channel).optional().describe("Where the chat is: Messenger, Instagram, SMS..."),
        stage: z.enum(BOT_STAGES),
        note: field(MAX.note).optional().describe("One short note, 280 characters at most."),
        booked_on: z.string().max(40).optional().describe("When the call is, for stage booked: YYYY-MM-DD or a date and time."),
      },
      run: async (a) => {
        const contactId = String(a.contact_id).trim();
        if (!isContactId(contactId)) return text("That contact id isn't one HelixOS can use.", true);
        const firstName = String(a.first_name);
        if (!firstName) return text("A first name is needed.", true);
        const said = await leadLog(m, { contactId, firstName, channel: (a.channel as string | undefined) || null, stage: a.stage as (typeof BOT_STAGES)[number], note: (a.note as string | undefined) || null, bookedOn: typeof a.booked_on === "string" ? a.booked_on : null });
        return text(said);
      },
    },
    {
      name: "webinar_register",
      write: true,
      description: "Signs a person up for the next webinar with their first name and email, and returns the link to join. Optional custom fields (industry, pain, problem, desire, or others) are kept with the sign-up.",
      input: {
        first_name: field(MAX.name),
        email: z.string().max(MAX.email).describe("Their email address."),
        contact_id: z.string().max(MAX.contactId).optional().describe("Their Community Loyalty contact id, if known."),
        custom: z.record(z.string().max(MAX.customKey), z.string().max(MAX.customValue * 2)).optional().describe("Optional answers: industry, pain, problem, desire, or other short fields (12 at most, 300 characters each)."),
      },
      run: async (a) => {
        const email = String(a.email).trim().toLowerCase();
        if (!isEmail(email)) return text("That email address doesn't look right. Please check it.", true);
        const firstName = String(a.first_name);
        if (!firstName) return text("A first name is needed.", true);
        const contactId = typeof a.contact_id === "string" && a.contact_id.trim() ? a.contact_id.trim() : null;
        if (contactId && !isContactId(contactId)) return text("That contact id isn't one HelixOS can use.", true);
        const custom = cleanCustom(a.custom as Record<string, unknown> | undefined);
        if (!custom.ok) return text(custom.error, true);
        const r = await webinarRegister(m, { firstName, email, contactId, custom: custom.fields });
        return text(r ? JSON.stringify(r) : "There's no webinar scheduled right now.");
      },
    },
    {
      name: "mf_prepare",
      write: true,
      description: "The Magic funnel: makes a personal registration page for the person in this conversation for the next webinar, and returns personal_url to send them (the Finalize Spot button). It doesn't register them; they register on the page with one tap. Give their Community Loyalty contact id, name, email and phone from the contact, their biggest pain and industry, any other answers, and an optional short summary of the conversation.",
      input: {
        contact_id: z.string().max(MAX.contactId).describe("The Community Loyalty contact id of the person in this conversation."),
        first_name: field(MAX.name),
        last_name: field(MAX.name).optional(),
        email: z.string().max(MAX.email).describe("Their email address."),
        phone: z.string().max(MF_MAX.phone * 2).optional().describe("Their phone number, if the contact has one."),
        pain: field(MF_MAX.pain).optional().describe("Their biggest pain in business, in their words."),
        industry: field(MF_MAX.industry).optional().describe("Their industry, in their words."),
        conversation_summary: field(MF_MAX.summary).optional().describe("A short summary of the conversation, 1,000 characters at most."),
        custom: z.record(z.string().max(MAX.customKey), z.string().max(MAX.customValue * 2)).optional().describe("Optional other answers (12 at most, 300 characters each)."),
      },
      run: async (a) => {
        const contactId = String(a.contact_id).trim();
        if (!isContactId(contactId)) return text("That contact id isn't one HelixOS can use.", true);
        const email = String(a.email).trim().toLowerCase();
        if (!isEmail(email)) return text("That email address doesn't look right. Please check it.", true);
        const firstName = cleanFirstName(a.first_name);
        if (!firstName) return text("A first name is needed.", true);
        const custom = cleanCustom(a.custom as Record<string, unknown> | undefined);
        if (!custom.ok) return text(custom.error, true);
        const r = await mfPrepare(m, { contactId, firstName, lastName: cleanText(String(a.last_name ?? "")).slice(0, MF_MAX.lastName), email, phone: cleanPhone(a.phone), pain: String(a.pain ?? ""), industry: String(a.industry ?? ""), summary: String(a.conversation_summary ?? ""), custom: custom.fields });
        if (!r.ok) return text(r.line, true);
        if (r.signupId) {
          const id = r.signupId;
          after(() => writeForSignup(id));
        }
        return text(JSON.stringify(r.body));
      },
    },
  ];
}

/** Which tool a POST calls, read before the server runs it, so the right limit applies: reads, or the writes' tighter ones. */
async function calledTool(request: Request): Promise<string | null> {
  try {
    const body = (await request.clone().json()) as { method?: string; params?: { name?: unknown } } | { method?: string; params?: { name?: unknown } }[];
    const msgs = Array.isArray(body) ? body : [body];
    const call = msgs.find((x) => x?.method === "tools/call");
    return call && typeof call.params?.name === "string" ? call.params.name : null;
  } catch {
    return null;
  }
}

export async function handleBotMcpRequest(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const m = key ? await memberForKey(key) : null;
  if (!m) return json(401, { error: "invalid_token", error_description: "This bot key isn't valid, or it was revoked." }, { "www-authenticate": 'Bearer realm="HelixOS bot"' });

  const tool = await calledTool(request);
  const write = tool !== null && isWrite(tool);
  const within = write
    ? (await allow(`botmcp:wmin:${m.keyId}`, LIMITS.writesPerMinute, 60_000)) && (await allow(`botmcp:wday:${m.workspaceId}:${m.userId}`, LIMITS.writesPerDay, 86_400_000))
    : await allow(`botmcp:rmin:${m.keyId}`, LIMITS.readsPerMinute, 60_000);
  if (!within) {
    if (tool) await logged(m, tool as BotTool, "rate limited", false);
    return json(429, { error: "rate_limited", error_description: BUSY_LINE, message: BUSY_LINE }, { "retry-after": "60" });
  }
  await touchKey(m.keyId);

  const server = new McpServer({ name: "HelixOS bot", version: APP_VERSION });
  for (const t of tools(m)) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.input, annotations: { readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: false } }, async (args) => {
      try {
        const r = await t.run((args ?? {}) as Record<string, unknown>);
        await logged(m, t.name, r.isError ? "refused" : "ok", !r.isError);
        return r;
      } catch {
        await logged(m, t.name, "error", false);
        return text("Something went wrong on HelixOS's side. Please try again later.", true);
      }
    });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close().catch(() => undefined);
  }
}
