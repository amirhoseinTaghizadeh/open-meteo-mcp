// What every tool looks like. mcp.ts turns this into MCP registrations.
import type { z } from 'zod';

export interface ToolDefinition<Input extends z.ZodObject, Output extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: Input; // the SDK validates against this before execute runs
  outputSchema: Output;
  execute(input: z.output<Input>): Promise<z.output<Output>>; // throws OpenMeteoError or ToolError
  summarize(output: z.output<Output>): string; // short text version for the content block
}

export function defineTool<Input extends z.ZodObject, Output extends z.ZodObject>(
  tool: ToolDefinition<Input, Output>,
): ToolDefinition<Input, Output> {
  return tool;
}

// "could not answer", but not because of Open-Meteo
export class ToolError extends Error {
  override readonly name = 'ToolError';
}
