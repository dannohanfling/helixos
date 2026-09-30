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

export type ToolResult = { text: string; data?: unknown };
export type ToolDef = {
  name: string;
  /** Null for the one tool every grant has (whoami). */
  scope: Scope | null;
  kind: "read" | "write";
  description: string;
  input: z.ZodRawShape;
  handler: (v: Viewer, input: Record<string, unknown>) => Promise<ToolResult>;
};
export type ScopeGate = (v: Viewer) => Promise<boolean>;

const tools = new Map<string, ToolDef>();
const gates = new Map<Scope, ScopeGate>();

export function defineScope(name: Scope, opts: { gate?: ScopeGate } = {}): void {
  if (opts.gate) gates.set(name, opts.gate);
}

export function defineTool(def: ToolDef): ToolDef {
  if (!isToolName(def.name)) throw new Error(`MCP tool name "${def.name}" must be letters, digits, underscores or hyphens (no dots)`);
  if (tools.has(def.name)) throw new Error(`MCP tool "${def.name}" is defined twice`);
  tools.set(def.name, def);
  return def;
}

/** The tools a grant may see: scope-less ones, and those whose scope it holds. */
export function toolsFor(scopes: readonly Scope[]): ToolDef[] {
  return [...tools.values()].filter((t) => t.scope === null || scopes.includes(t.scope));
}

export const allTools = (): ToolDef[] => [...tools.values()];
export const gateFor = (scope: Scope): ScopeGate | undefined => gates.get(scope);
