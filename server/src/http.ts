// Entry point: MCP over HTTP plus the built UI.
import { loadConfig } from './config.ts';
import { createRateLimiter } from './guard.ts';
import { createHttpServer } from './http-server.ts';

const config = loadConfig();

createHttpServer({
  allowedHosts: config.allowedHosts,
  staticDir: config.staticDir,
  bearerToken: config.bearerToken,
  mcp: {
    rateLimiter: createRateLimiter({ limit: config.toolCallsPerMinute, windowMs: 60_000 }),
  },
}).listen(config.port, config.host, () => {
  console.log(`open-meteo-mcp listening on http://${config.host}:${config.port}`);
  console.log(`  MCP endpoint  POST http://localhost:${config.port}/mcp`);
  console.log(`  Web UI        GET  http://localhost:${config.port}/ (when web/dist is built)`);
  console.log(
    `  Auth          ${config.bearerToken === undefined ? 'none' : 'bearer token required on /mcp'}`,
  );
});
