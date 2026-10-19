// Ambient typing for the MCP source check only (tsconfig.mcp.json).
// The MCP runs on the Deno edge runtime, which provides Node's `process.env`.
declare const process: { env: Record<string, string | undefined> };
