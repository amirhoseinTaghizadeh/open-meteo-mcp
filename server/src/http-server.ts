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

// JSON-RPC tool calls are a few KB; anything bigger is a mistake or an attack
export const MAX_BODY_BYTES = 1_048_576;

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
  const [scheme, presented, ...rest] = header.split(' ');
  if (rest.length > 0 || !presented || scheme?.toLowerCase() !== 'bearer') return false;
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
  // The SDK would buffer the whole body itself, with no limit. Read it here
  // behind a cap and hand the parsed body over.
  const body = await readJsonBody(req, res);
  if (body === undefined) return;

  const server = buildServer(options);
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

// Returns undefined after answering 413 or 400 itself.
async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_BODY_BYTES) return tooLarge(res);

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return tooLarge(res);
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    res
      .writeHead(400, { 'content-type': 'application/json' })
      .end(rpcError(-32700, 'Parse error: Invalid JSON'));
    return undefined;
  }
}

function tooLarge(res: ServerResponse): undefined {
  // "connection: close" so Node drops the socket once the answer is flushed
  res
    .writeHead(413, { 'content-type': 'application/json', connection: 'close' })
    .end(rpcError(-32600, `Request body must be under ${MAX_BODY_BYTES} bytes`));
  return undefined;
}

function rpcError(code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null });
}
