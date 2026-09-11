// Registers the tools with the MCP server and maps results onto the protocol:
// success -> text + structuredContent, known failure -> isError with a sentence,
// bug -> logged, then isError with a generic message.
import { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { stderrAuditSink, type AuditOutcome, type AuditSink } from './audit.ts';
import { unlimited, type RateLimiter } from './guard.ts';
import { OpenMeteoError } from './openmeteo/errors.ts';
import { compareLocations } from './tools/compare-locations.ts';
import { ToolError, type ToolDefinition } from './tools/define.ts';
import { getForecast } from './tools/get-forecast.ts';
import { searchPlaces } from './tools/search-places.ts';

export const SERVER_INFO = { name: 'open-meteo-mcp', version: '1.0.0' } as const;

export interface ServerOptions {
  audit?: AuditSink;
  rateLimiter?: RateLimiter;
}

// one per stdio process, one per request over http; options are shared
export function buildServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer(SERVER_INFO);
  const guards: Guards = {
    audit: options.audit ?? stderrAuditSink,
    rateLimiter: options.rateLimiter ?? unlimited,
  };
  registerTool(server, searchPlaces, guards);
  registerTool(server, getForecast, guards);
  registerTool(server, compareLocations, guards);
  return server;
}

type AnyTool = ToolDefinition<z.ZodObject, z.ZodObject>;

interface Guards {
  audit: AuditSink;
  rateLimiter: RateLimiter;
}

function registerTool(server: McpServer, tool: AnyTool, { audit, rateLimiter }: Guards): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      const ts = new Date().toISOString();
      const started = performance.now();
      const record = (outcome: AuditOutcome, error?: string) =>
        audit({
          ts,
          tool: tool.name,
          args: input,
          outcome,
          durationMs: Math.round(performance.now() - started),
          ...(error === undefined ? {} : { error }),
        });

      const admission = rateLimiter.take();
      if (!admission.ok) {
        const seconds = Math.max(1, Math.ceil(admission.retryAfterMs / 1000));
        const message = `Rate limit reached for this server. Try again in ${seconds}s.`;
        record('rate_limited', message);
        return failure(message);
      }

      try {
        const output = await tool.execute(input);
        record('ok');
        return {
          content: [{ type: 'text', text: tool.summarize(output) }],
          structuredContent: output,
        };
      } catch (error) {
        if (error instanceof OpenMeteoError || error instanceof ToolError) {
          record('error', error.message);
          return failure(error.message);
        }
        record('unexpected', error instanceof Error ? error.message : String(error));
        // stderr only: stdout is the protocol channel on stdio
        console.error(`[${tool.name}] unexpected error`, error);
        return failure(`Internal error in ${tool.name}. The problem has been logged.`);
      }
    },
  );
}

function failure(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text }] };
}
