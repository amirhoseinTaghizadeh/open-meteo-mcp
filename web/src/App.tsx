import { useState } from 'react';
import { ResultPanel, type Outcome } from './ResultPanel.tsx';
import { ToolForm, type InputSchema } from './ToolForm.tsx';
import { useMcpClient } from './useMcpClient.ts';

export function App() {
  const { status, callTool } = useMcpClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ tool: string; value: Outcome } | null>(null);

  if (status.state === 'connecting') return <Shell>Connecting to /mcp…</Shell>;
  if (status.state === 'error') {
    return (
      <Shell>
        <pre className="error">Could not connect to the MCP server: {status.message}</pre>
      </Shell>
    );
  }

  const tool = status.tools.find((t) => t.name === selected) ?? status.tools[0];
  if (!tool) return <Shell>The server exposes no tools.</Shell>;

  async function run(args: Record<string, unknown>) {
    if (!tool) return;
    setBusy(true);
    const started = performance.now();
    try {
      const result = await callTool(tool.name, args);
      setOutcome({
        tool: tool.name,
        value: { kind: 'result', result, ms: Math.round(performance.now() - started) },
      });
    } catch (error) {
      setOutcome({
        tool: tool.name,
        value: {
          kind: 'protocol-error',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <nav aria-label="Tools">
        {status.tools.map((t) => (
          <button
            key={t.name}
            type="button"
            aria-pressed={t.name === tool.name}
            onClick={() => {
              setSelected(t.name);
              setOutcome(null);
            }}
          >
            {t.name}
          </button>
        ))}
      </nav>

      <section>
        <h2>{tool.title ?? tool.name}</h2>
        <p>{tool.description}</p>
        {/* key forces a fresh form (and fresh defaults) when the tool changes */}
        <ToolForm
          key={tool.name}
          schema={tool.inputSchema as InputSchema}
          busy={busy}
          onSubmit={(args) => void run(args)}
        />
      </section>

      {outcome?.tool === tool.name && (
        <section>
          <ResultPanel outcome={outcome.value} />
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <header>
        <h1>Open-Meteo MCP</h1>
        <p className="status">
          A browser MCP client for the server's tools. Forms are generated from each tool's input
          schema.
        </p>
      </header>
      {children}
    </main>
  );
}
