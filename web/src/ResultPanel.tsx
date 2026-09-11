import type { CallToolResult } from '@modelcontextprotocol/client';

export type Outcome =
  | { kind: 'result'; result: CallToolResult; ms: number }
  | { kind: 'protocol-error'; message: string };

export function ResultPanel({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === 'protocol-error') {
    return (
      <div className="result">
        <h3>Protocol error</h3>
        <pre className="error">{outcome.message}</pre>
      </div>
    );
  }

  const { result, ms } = outcome;
  const text = result.content
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('\n');

  return (
    <div className="result">
      <h3>{result.isError ? 'Tool error' : `Text content (${ms} ms)`}</h3>
      <pre className={result.isError ? 'error' : undefined}>{text}</pre>
      {result.structuredContent !== undefined && (
        <>
          <h3>Structured content</h3>
          <pre>{JSON.stringify(result.structuredContent, null, 2)}</pre>
        </>
      )}
    </div>
  );
}
