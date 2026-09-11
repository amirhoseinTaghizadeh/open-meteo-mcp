import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentAuditSink } from '../src/audit.ts';
import { createHttpServer, MAX_BODY_BYTES } from '../src/http-server.ts';

let baseUrl: string;
let server: ReturnType<typeof createHttpServer>;
let sandbox: string;

// static root is <sandbox>/public; secret.txt sits just outside it
beforeAll(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), 'mcp-http-test-'));
  const staticDir = path.join(sandbox, 'public');
  await mkdir(path.join(staticDir, 'assets'), { recursive: true });
  await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>ui</title>');
  await writeFile(path.join(staticDir, 'assets', 'app.js'), 'console.log("hi")');
  await writeFile(path.join(sandbox, 'secret.txt'), 'nope');

  server = createHttpServer({
    allowedHosts: ['localhost', '127.0.0.1'],
    staticDir,
    mcp: { audit: silentAuditSink },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(sandbox, { recursive: true, force: true });
});

describe('routing', () => {
  it('answers the health probe', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
  });

  it('serves the UI and its assets with content types', async () => {
    const index = await fetch(`${baseUrl}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');

    const asset = await fetch(`${baseUrl}/assets/app.js`);
    expect(asset.headers.get('content-type')).toContain('javascript');
  });

  it('caches hashed assets forever and index.html not at all', async () => {
    const index = await fetch(`${baseUrl}/`);
    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(index.headers.get('x-content-type-options')).toBe('nosniff');

    const asset = await fetch(`${baseUrl}/assets/app.js`);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('never serves files outside the static root', async () => {
    const res = await fetch(`${baseUrl}/%2e%2e/secret.txt`);
    expect(res.status).toBe(404);
  });

  it('404s unknown paths instead of falling back to index.html', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('rejects requests whose Host header is not allowlisted', async () => {
    // fetch() drops a custom Host header, http.request keeps it
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        `${baseUrl}/mcp`,
        { method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(403);
  });
});

describe('bearer token', () => {
  const token = 'test-token';
  let authed: ReturnType<typeof createHttpServer>;
  let authedUrl: string;

  beforeAll(async () => {
    authed = createHttpServer({
      allowedHosts: ['127.0.0.1'],
      bearerToken: token,
      mcp: { audit: silentAuditSink },
    });
    await new Promise<void>((resolve) => authed.listen(0, '127.0.0.1', resolve));
    authedUrl = `http://127.0.0.1:${(authed.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => authed.close(() => resolve())));

  async function list(headers: Record<string, string>) {
    return fetch(`${authedUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
  }

  it('is required on /mcp when configured', async () => {
    const missing = await list({});
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe('Bearer');

    const wrong = await list({ authorization: `Bearer ${token}x` });
    expect(wrong.status).toBe(401);

    const right = await list({ authorization: `Bearer ${token}` });
    expect(right.status).toBe(200);
  });

  it('is not required for the health probe', async () => {
    expect((await fetch(`${authedUrl}/healthz`)).status).toBe(200);
  });

  it('works with the SDK client', async () => {
    const client = new Client({ name: 'auth-test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${authedUrl}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    expect((await client.listTools()).tools).toHaveLength(3);
    await client.close();
  });
});

describe('request body limit', () => {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };

  it('rejects a body whose declared length is over the cap, before reading it', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: '{"jsonrpc":"2.0","id":1,"method":"ping","pad":"' + 'a'.repeat(MAX_BODY_BYTES) + '"}',
    });
    expect(res.status).toBe(413);
    expect(res.headers.get('connection')).toBe('close');
  });

  it('rejects a chunked body that grows past the cap', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${baseUrl}/mcp`,
        { method: 'POST', headers: { ...headers, 'transfer-encoding': 'chunked' } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', (error: NodeJS.ErrnoException) => {
        // the server may drop the socket while we are still writing
        if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE') reject(error);
      });
      const chunk = 'a'.repeat(64 * 1024);
      for (let sent = 0; sent <= MAX_BODY_BYTES; sent += chunk.length) req.write(chunk);
      req.end();
    });
    expect(status).toBe(413);
  });

  it('answers malformed JSON with a JSON-RPC parse error', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', headers, body: '{not json' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: -32700 } });
  });
});

describe('MCP over Streamable HTTP', () => {
  it('refuses methods other than POST instead of holding a stream open', async () => {
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const res = await fetch(`${baseUrl}/mcp`, {
        method,
        headers: { accept: 'application/json, text/event-stream' },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
  });

  it('serves a real client session', async () => {
    const client = new Client({ name: 'http-test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(3);

    await client.close();
  });
});
