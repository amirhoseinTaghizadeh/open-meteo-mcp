// Entry point for stdio clients like Claude Desktop. Never console.log here,
// stdout is the protocol channel.
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.ts';
import { createRateLimiter } from './guard.ts';
import { buildServer } from './mcp.ts';

const config = loadConfig();

await buildServer({
  rateLimiter: createRateLimiter({ limit: config.toolCallsPerMinute, windowMs: 60_000 }),
}).connect(new StdioServerTransport());
