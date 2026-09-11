// The one error the client throws. `message` is already a readable sentence.
export type OpenMeteoErrorKind = 'timeout' | 'network' | 'http' | 'shape';

export class OpenMeteoError extends Error {
  override readonly name = 'OpenMeteoError';
  readonly kind: OpenMeteoErrorKind;
  readonly status: number | undefined;

  constructor(kind: OpenMeteoErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}
