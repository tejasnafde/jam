import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const textResult = (text: string): CallToolResult => ({ content: [{ type: "text", text }] });

export const jsonResult = (value: unknown): CallToolResult => textResult(JSON.stringify(value, null, 2));

export const errorResult = (text: string): CallToolResult => ({ ...textResult(text), isError: true });
