/**
 * The MCP server's tool registry (rev 224): every tool declares its scope, whether it reads or writes, a Zod input schema
 * and a handler that gets the member's Viewer. A scope may carry a gate checked live on every call (Body's is
 * `canAiUseBody`). The server lists only the tools whose scope the grant holds, then checks the scope and the gate again
 * on each call. Body adds `src/lib/mcp/tools/body.ts` with `defineScope("body", { gate })` and its tools, and never touches
 * tokens, consent or the route.
 */
import type { z } from "zod";
import type { Viewer } from "@/lib/auth";
import { isToolName, type Scope } from "@/lib/engine/mcp";

/** `images`: pictures sent back as MCP image blocks after the text (base64 bytes and their type), never as a link (H-591). */
export type ToolResult = { text: string; data?: unknown; images?: { data: string; mimeType: string }[] };
/**
 * `appId`: the connection the call came through; `switched`: on an agent token inside a client's HelixOS (H-1385), the
 * client's viewer the client tools act as, while `v` for the agent's own tools stays the coach's own.
 */
export type ToolCall = { scopes: readonly Scope[]; agentId?: string | null; appId?: string; switched?: Viewer | null };
export type ToolDef = {
  name: string;
  /** Null for the one tool every grant has (whoami). */
  scope: Scope | null;
  kind: "read" | "write";
  /**
   * The coach's own connection only (H-591): listed and run only for a coach, not switched into a client and not a team member,
   * calling through a connection they signed in with. Never on an agent token, whatever its scopes.
   */
  coachOnly?: boolean;
  description: string;
  input: z.ZodRawShape;
  /**
   * `call`: what this connection may do (whoami names it), and the Forum agent it speaks as (rev 769), if any; a walk calling
   * a handler directly may leave it out.
   */
  handler: (v: Viewer, input: Record<string, unknown>, call?: ToolCall) => Promise<ToolResult>;
};
export type ScopeGate = (v: Viewer) => Promise<boolean>;

const tools = new Map<string, ToolDef>();
const gates = new Map<Scope, ScopeGate>();

export function defineScope(name: Scope, opts: { gate?: ScopeGate } = {}): void {
  if (opts.gate) gates.set(name, opts.gate);
}

export function defineTool(def: ToolDef): ToolDef {
  if (!isToolName(def.name)) throw new Error(`MCP tool name "${def.name}" must be letters, digits, underscores or hyphens (no dots)`);
  // Two definitions of one name is a mistake, except under the dev server, where it's a hot reload of a tool module (the
  // registry's map survives, the module runs again), which used to make every MCP request fail until a restart.
  if (tools.has(def.name) && process.env.NODE_ENV !== "development") throw new Error(`MCP tool "${def.name}" is defined twice`);
  tools.set(def.name, def);
  return def;
}

/** Who is calling, for the coach-only tools: on an agent token, and whether they're the coach themselves. */
export type Caller = { agentToken: boolean; viewer: Pick<Viewer, "role" | "switchedInto" | "team"> };

/** The coach's own connection: the coach themselves, not switched into a client, not a team member, not an agent token. */
export function isCoachOwn(c: Caller | undefined): boolean {
  return Boolean(c && !c.agentToken && c.viewer.role === "coach" && !c.viewer.switchedInto && !c.viewer.team);
}

/** The tools a grant may see: scope-less ones, and those whose scope it holds; a coach-only tool only for the coach's own connection. */
export function toolsFor(scopes: readonly Scope[], caller?: Caller): ToolDef[] {
  return [...tools.values()].filter((t) => (t.scope === null || scopes.includes(t.scope)) && (!t.coachOnly || isCoachOwn(caller)));
}

export const allTools = (): ToolDef[] => [...tools.values()];
export const gateFor = (scope: Scope): ScopeGate | undefined => gates.get(scope);
