import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SoundIndex } from "../sounds/soundIndex.js";
import type { Store } from "../store/types.js";

/** What every tool needs: the caller's uid and the services. */
export interface ToolContext {
  uid: string;
  store: Store;
  sounds: SoundIndex;
}

export type ToolRegistrar = (server: McpServer, ctx: ToolContext) => void;

/** Tools that only read. None of them can change the user's music. */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** The plan tools: the only writes the coach can make. */
export const PLAN_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
