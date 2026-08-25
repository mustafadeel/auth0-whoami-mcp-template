import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

// Add MCP tools here. `authInfo.extra.sub` is the authenticated Auth0 user's ID (always
// present on a valid access token); other claims are not populated unless a Post-Login
// Action explicitly copies them into the access token.
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "auth0-whoami-mcp", version: "1.0.0" });
  server.registerTool(
    "whoami",
    { description: "Return the authenticated Auth0 user's ID." },
    async (extra) => {
      const authInfo = (extra as { authInfo?: AuthInfo } | undefined)?.authInfo;
      const claims = authInfo?.extra as { sub?: unknown } | undefined;
      const result = { user_id: typeof claims?.sub === "string" ? claims.sub : null };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
  return server;
}
