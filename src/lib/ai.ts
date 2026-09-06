import Anthropic from "@anthropic-ai/sdk";

/** Optional Claude drafting. Returns null when no ANTHROPIC_API_KEY is configured so every feature still works without it. */
export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function draft(system: string, user: string, maxTokens = 4000): Promise<string | null> {
  if (!aiEnabled()) return null;
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") return null;
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export const VOICE = `Write in the coach's voice: direct, clear, punchy, heart-led not fluffy. 4th-grade reading level. Short sentences. One line per thought with line breaks between thoughts. No corporate jargon, no empty hype, no "here's the real magic", no "this isn't just about X, it's about Y". Never use em dashes.`;
