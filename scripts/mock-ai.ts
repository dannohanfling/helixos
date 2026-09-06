/**
 * A stand-in for the Anthropic and OpenAI APIs for smoke tests. `npx tsx scripts/mock-ai.ts 4020`, then run the app with
 * AI_BASE_URL=http://localhost:4020. Keys: sk-ant-good / sk-good work; sk-ant-nobill and sk-nobill have no billing; anything else is 401.
 * Replies with a JSON object when the prompt asks for JSON, otherwise with a short drafted paragraph.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4020);

function reply(system: string, user: string): string {
  if (/JSON object keyed by/i.test(system)) {
    const keys = Array.from(user.matchAll(/^- ([\w:_-]+):/gm)).map((m) => m[1]);
    return JSON.stringify(Object.fromEntries(keys.map((k) => [k, { body: `Mock AI draft for ${k}.\nOne thought per line.\nWhat would you try first?` }])));
  }
  return "Mock AI draft.\nShort lines.\nOne idea each.\nWhat would you try first?";
}

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = req.url ?? "";
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const body = (() => {
      try {
        return JSON.parse(Buffer.concat(chunks).toString() || "{}") as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    if (url.startsWith("/v1/messages")) {
      const key = req.headers["x-api-key"] as string | undefined;
      if (key === "sk-ant-nobill") return json(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } });
      if (key !== "sk-ant-good") return json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      const user = String((body.messages as { content: string }[] | undefined)?.[0]?.content ?? "");
      const text = reply(String(body.system ?? ""), user);
      const inTok = Math.ceil((String(body.system ?? "").length + user.length) / 4);
      const outTok = Math.ceil(text.length / 4);
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const ev = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        ev("message_start", { type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inTok, output_tokens: 0 } } });
        ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
        ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
        ev("content_block_stop", { type: "content_block_stop", index: 0 });
        ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: outTok } });
        ev("message_stop", { type: "message_stop" });
        return res.end();
      }
      return json(200, { id: "msg_mock", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: inTok, output_tokens: outTok } });
    }
    if (url.startsWith("/v1/responses")) {
      const auth = (req.headers.authorization ?? "").replace("Bearer ", "");
      if (auth === "sk-nobill") return json(429, { error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota" } });
      if (auth !== "sk-good") return json(401, { error: { message: "Incorrect API key provided: sk-xxx.", type: "invalid_request_error", code: "invalid_api_key" } });
      const text = reply(String(body.instructions ?? ""), String(body.input ?? ""));
      return json(200, { id: "resp_mock", object: "response", model: body.model, status: "completed", output: [{ type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }], output_text: text, usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 } });
    }
    return json(404, { error: "not found" });
  });
}).listen(port, () => console.log(`mock AI on http://localhost:${port}`));
