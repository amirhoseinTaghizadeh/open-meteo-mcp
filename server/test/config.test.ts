import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      port: 3000,
      host: '127.0.0.1',
      allowedHosts: ['localhost', '127.0.0.1'],
      toolCallsPerMinute: 60,
    });
    expect(config.staticDir).toMatch(/web[\\/]dist$/);
  });

  it('treats an empty bearer token as unset', () => {
    expect(loadConfig({}).bearerToken).toBeUndefined();
    expect(loadConfig({ MCP_BEARER_TOKEN: '  ' }).bearerToken).toBeUndefined();
    expect(loadConfig({ MCP_BEARER_TOKEN: ' s3cret ' }).bearerToken).toBe('s3cret');
  });

  it('parses and trims the host allowlist', () => {
    expect(loadConfig({ ALLOWED_HOSTS: ' mcp.example , localhost,' }).allowedHosts).toEqual([
      'mcp.example',
      'localhost',
    ]);
  });

  it('fails loudly on an invalid port or limit instead of listening on NaN', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT must be an integer/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => loadConfig({ TOOL_CALLS_PER_MINUTE: '-5' })).toThrow(/TOOL_CALLS_PER_MINUTE/);
    expect(loadConfig({ PORT: '8080', TOOL_CALLS_PER_MINUTE: '0' })).toMatchObject({
      port: 8080,
      toolCallsPerMinute: 0,
    });
  });
});
