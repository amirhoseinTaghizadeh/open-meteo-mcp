// A real MCP client in the browser, talking to /mcp on the same origin.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnectionStatus =
  { state: 'connecting' } | { state: 'ready'; tools: Tool[] } | { state: 'error'; message: string };

export function useMcpClient() {
  const clientRef = useRef<Client | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>({ state: 'connecting' });

  useEffect(() => {
    let cancelled = false;
    const client = new Client({ name: 'open-meteo-mcp-web', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', window.location.origin));

    client
      .connect(transport)
      .then(() => client.listTools())
      .then(({ tools }) => {
        if (cancelled) return;
        clientRef.current = client;
        setStatus({ state: 'ready', tools });
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus({ state: 'error', message: describe(error) });
      });

    return () => {
      cancelled = true;
      clientRef.current = null;
      void client.close();
    };
  }, []);

  const callTool = useCallback(
    (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
      const client = clientRef.current;
      if (client === null) return Promise.reject(new Error('Not connected'));
      return client.callTool({ name, arguments: args });
    },
    [],
  );

  return { status, callTool };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
