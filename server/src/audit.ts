// One JSON line per tool call. Goes to stderr because stdout is the protocol
// channel on stdio. The sink is a function so tests can capture entries.

export type AuditOutcome = 'ok' | 'error' | 'rate_limited' | 'unexpected';

export interface AuditEntry {
  ts: string;
  tool: string;
  args: unknown;
  outcome: AuditOutcome;
  durationMs: number;
  error?: string;
}

export type AuditSink = (entry: AuditEntry) => void;

export const stderrAuditSink: AuditSink = (entry) => {
  process.stderr.write(JSON.stringify({ event: 'tool_call', ...entry }) + '\n');
};

export const silentAuditSink: AuditSink = () => undefined;
