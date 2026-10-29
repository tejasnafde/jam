export const mcpUrl = (origin: string) => `${origin}/mcp`;

/** The Claude Code command that registers jam as a remote MCP server. */
export const claudeCommand = (origin: string, token: string) =>
  `claude mcp add --transport http jam ${mcpUrl(origin)} --header "Authorization: Bearer ${token}"`;
