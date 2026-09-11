// Real MCP client against the server over an in-memory transport.
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { silentAuditSink, type AuditEntry } from '../src/audit.ts';
import { createRateLimiter } from '../src/guard.ts';
import { buildServer, type ServerOptions } from '../src/mcp.ts';
import { clearCache } from '../src/openmeteo/client.ts';
import { forecastLisbon, geocodingLisbon, jsonResponse } from './fixtures.ts';

async function connect(options: ServerOptions = { audit: silentAuditSink }): Promise<Client> {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await buildServer(options).connect(serverSide);
  const client = new Client({ name: 'protocol-test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

function textOf(result: { content: unknown }): string {
  const [first] = result.content as { type: string; text?: string }[];
  return first?.text ?? '';
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearCache();
});

describe('tools/list', () => {
  it('advertises three tools with input and output schemas, defaults visible', async () => {
    const { tools } = await (await connect()).listTools();

    expect(tools.map((t) => t.name)).toEqual([
      'search_places',
      'get_forecast',
      'compare_locations',
    ]);
    for (const tool of tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }

    // defaults show up in the schema so the UI can pre-fill them
    const search = tools.find((t) => t.name === 'search_places');
    const properties = search?.inputSchema.properties as Record<string, { default?: unknown }>;
    expect(properties['count']?.default).toBe(5);
    expect(search?.inputSchema.required ?? []).toEqual(['query']);
  });
});

describe('tools/call', () => {
  it('returns text and structuredContent on success', async () => {
    vi.stubGlobal('fetch', () => jsonResponse(geocodingLisbon));

    const result = await (
      await connect()
    ).callTool({
      name: 'search_places',
      arguments: { query: 'Lisbon' },
    });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('Lisbon, Lisbon, Portugal');
    expect(result.structuredContent).toMatchObject({
      query: 'Lisbon',
      results: expect.arrayContaining([
        expect.objectContaining({ name: 'Lisbon', countryCode: 'PT' }),
      ]),
    });
  });

  it('rejects invalid arguments before the tool runs', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await (
      await connect()
    ).callTool({
      name: 'get_forecast',
      arguments: { latitude: 999, longitude: 0 },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/latitude/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('turns an upstream failure into an isError result, not a protocol error', async () => {
    vi.stubGlobal('fetch', () => jsonResponse({ error: true, reason: 'Service unavailable' }, 503));

    const result = await (
      await connect()
    ).callTool({
      name: 'get_forecast',
      arguments: { latitude: 38.7, longitude: -9.1 },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Open-Meteo rejected the request: Service unavailable');
  });

  it('logs an unexpected error and answers with a generic isError, not the raw message', async () => {
    // a TypeError = a bug, not an upstream failure
    vi.stubGlobal('fetch', () => ({
      get ok(): boolean {
        throw new TypeError('secret internal detail');
      },
      json: () => Promise.resolve({}),
    }));
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await (
      await connect()
    ).callTool({ name: 'search_places', arguments: { query: 'Lisbon' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Internal error in search_places. The problem has been logged.');
    expect(stderr).toHaveBeenCalledOnce();
    expect(String(stderr.mock.calls[0]?.[1])).toContain('secret internal detail');
    stderr.mockRestore();
  });

  it('refuses calls over the rate limit with an actionable isError, before any upstream call', async () => {
    const fetchSpy = vi.fn(() => jsonResponse(geocodingLisbon));
    vi.stubGlobal('fetch', fetchSpy);
    const entries: AuditEntry[] = [];
    const client = await connect({
      audit: (entry) => entries.push(entry),
      rateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    });

    const first = await client.callTool({ name: 'search_places', arguments: { query: 'Lisbon' } });
    const second = await client.callTool({
      name: 'get_forecast',
      arguments: { latitude: 1, longitude: 1 },
    });

    expect(first.isError).toBeFalsy();
    expect(second.isError).toBe(true);
    expect(textOf(second)).toMatch(/Rate limit reached.*Try again in \d+s/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(entries.map((e) => e.outcome)).toEqual(['ok', 'rate_limited']);
  });

  it('writes one audit entry per call, whatever the outcome', async () => {
    vi.stubGlobal('fetch', (input: string | URL) =>
      String(input).includes('name=Lisbon')
        ? jsonResponse(geocodingLisbon)
        : jsonResponse({ error: true, reason: 'down' }, 503),
    );
    const entries: AuditEntry[] = [];
    const client = await connect({ audit: (entry) => entries.push(entry) });

    await client.callTool({ name: 'search_places', arguments: { query: 'Lisbon' } });
    await client.callTool({ name: 'search_places', arguments: { query: 'Porto' } });

    expect(entries).toEqual([
      expect.objectContaining({
        tool: 'search_places',
        args: { query: 'Lisbon', count: 5 },
        outcome: 'ok',
        durationMs: expect.any(Number),
      }),
      expect.objectContaining({ outcome: 'error', error: 'Open-Meteo rejected the request: down' }),
    ]);
    expect(entries[0]?.error).toBeUndefined();
  });

  it('runs compare_locations end to end', async () => {
    vi.stubGlobal('fetch', (input: string | URL) =>
      jsonResponse(String(input).includes('geocoding') ? geocodingLisbon : forecastLisbon),
    );

    const result = await (
      await connect()
    ).callTool({
      name: 'compare_locations',
      arguments: { places: ['Lisbon', 'Porto'], days: 2 },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ days: 2, warmest: 'Lisbon' });
    expect(textOf(result)).toContain('Warmest: Lisbon');
  });
});
