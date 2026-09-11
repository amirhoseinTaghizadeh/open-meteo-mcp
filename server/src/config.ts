// Env vars, checked once at startup so a typo fails loudly.
import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  allowedHosts: string[];
  staticDir: string;
  toolCallsPerMinute: number; // 0 disables
  bearerToken: string | undefined; // unset = no auth
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: integer(env, 'PORT', 3000, 1, 65535),
    host: env['HOST'] ?? '127.0.0.1',
    allowedHosts: list(env['ALLOWED_HOSTS'] ?? 'localhost,127.0.0.1'),
    staticDir: env['STATIC_DIR'] ?? path.resolve(import.meta.dirname, '../../web/dist'),
    toolCallsPerMinute: integer(env, 'TOOL_CALLS_PER_MINUTE', 60, 0, 1_000_000),
    bearerToken: nonEmpty(env['MCP_BEARER_TOKEN']),
  };
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

function nonEmpty(raw: string | undefined): string | undefined {
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

function list(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
