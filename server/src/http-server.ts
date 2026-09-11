// One http server: POST /mcp, GET /healthz, and the built UI as static files.
import {
  hostHeaderValidation,
  NodeStreamableHTTPServerTransport,
  originValidation,
} from '@modelcontextprotocol/node';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { buildServer, type ServerOptions } from './mcp.ts';
import { createStaticHandler } from './static.ts';

export interface HttpServerOptions {
  allowedHosts: string[];
  staticDir?: string;
  mcp?: ServerOptions;
  // when set, /mcp needs "Authorization: Bearer <token>"
  bearerToken?: string | undefined;
}

export function createHttpServer({
  allowedHosts,
  staticDir,
  mcp = {},
  bearerToken,
}: HttpServerOptions): Server {
  const validateHost = hostHeaderValidation(allowedHosts);
  const validateOrigin = originValidation(allowedHosts);
  const serveStatic = staticDir === undefined ? undefined : createStaticHandler(staticDir);

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error('Unhandled error while serving', req.method, req.url, error);
      if (!res.headersSent) res.writeHead(500).end('Internal server error');
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const { pathname } = new URL(req.url ?? '/', 'http://placeholder');

    res.setHeader('x-content-type-options', 'nosniff');

    if (pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }

    if (!validateHost(req, res) || !validateOrigin(req, res)) return;

    if (pathname === '/mcp') {
      // no sessions here, so GET (SSE stream) and DELETE make no sense
      if (method !== 'POST') {
        res.writeHead(405, { allow: 'POST' }).end('Method not allowed');
        return;
      }
      if (bearerToken !== undefined && !bearerMatches(req, bearerToken)) {
        res
          .writeHead(401, { 'www-authenticate': 'Bearer', 'content-type': 'application/json' })
          .end(JSON.stringify({ error: 'A valid bearer token is required for /mcp' }));
        return;
      }
      await handleMcp(req, res, mcp);
      return;
    }

    if (serveStatic !== undefined && (method === 'GET' || method === 'HEAD')) {
      await serveStatic(pathname, method, res);
      return;
    }

    res.writeHead(404).end('Not found');
  }
}

function bearerMatches(req: IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization ?? '';
  const [scheme, presented = ''] = header.split(' ', 2);
  if (scheme?.toLowerCase() !== 'bearer') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Stateless: a new server + transport per request. An McpServer can only
// have one transport, and the tools don't need sessions anyway.
async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  options: ServerOptions,
): Promise<void> {
  const server = buildServer(options);
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
