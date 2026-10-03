export type ErrorKind =
  'validation' | 'http' | 'transport' | 'timeout' | 'cancelled' | 'protocol' | 'pagination';

export class SdkError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly requestId: string | undefined;

  constructor(
    kind: ErrorKind,
    message: string,
    details: { status?: number; code?: string; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'SdkError';
    this.kind = kind;
    this.status = details.status;
    this.code = details.code;
    this.requestId = details.requestId;
  }
}
