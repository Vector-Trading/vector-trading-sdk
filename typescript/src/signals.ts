import type {
  SignalPayload,
  OpenSignalPayload,
  UpdateSignalPayload,
  CancelSignalPayload,
  CloseSignalPayload,
  StartSignalPayload,
  PauseSignalPayload,
  StopSignalPayload,
  DeleteSignalPayload,
} from '../../generation/generated/typescript/models/index.js';
import { SignalPayloadToJSON } from '../../generation/generated/typescript/models/SignalPayload.js';
import { SdkError } from './errors.js';
import { object, validateModel } from './validation.js';

export type SignalInput<T extends SignalPayload = SignalPayload> = T extends SignalPayload
  ? Omit<T, 'timestamp'> & { timestamp?: string }
  : never;
export type BuilderInput<T extends SignalPayload> = Omit<T, 'action' | 'timestamp'> & {
  timestamp?: string;
};
export type StrategySignalPayload = SignalPayload;

function invalid(message: string): never {
  throw new SdkError('validation', message);
}
export function validateSignal(payload: SignalPayload): void {
  validateModel('SignalPayload', payload);
  if (!Number.isSafeInteger(Number(payload.timestamp)))
    invalid('timestamp must represent a safe integer');
  if (payload.action !== 'open' && payload.action !== 'update') return;
  const { side, price, triggerPrice, stop, takeProfits } = payload.order;
  const buy = side === 'buy';
  const base = price ?? triggerPrice ?? payload.marketPrice;
  if (
    price !== undefined &&
    (buy
      ? price > (triggerPrice ?? payload.marketPrice)
      : price < (triggerPrice ?? payload.marketPrice))
  )
    invalid('limit price is on the wrong side');
  if (
    triggerPrice !== undefined &&
    (buy ? triggerPrice < payload.marketPrice : triggerPrice > payload.marketPrice)
  )
    invalid('trigger price is on the wrong side');
  if (stop !== undefined && (buy ? stop >= base : stop <= base))
    invalid('stop is on the wrong side');
  let total = 0;
  for (const target of takeProfits ?? []) {
    if (buy ? target.price <= base : target.price >= base)
      invalid('take-profit price is on the wrong side');
    total += target.percent;
  }
  if (total > 100 + 1e-8) invalid('take-profit total exceeds 100');
}

export function serializeSignal(payload: SignalPayload): string {
  validateSignal(payload);
  const body = JSON.stringify(SignalPayloadToJSON(payload));
  if (new TextEncoder().encode(body).length > 16 * 1024) invalid('Signal body exceeds 16 KiB');
  return body;
}
export function buildSignal<T extends SignalPayload>(input: SignalInput<T>): T {
  if (!object(input)) throw new SdkError('validation', 'Signal input must be an object');
  const payload = {
    ...input,
    timestamp: input.timestamp === undefined ? String(Date.now()) : input.timestamp,
  } as unknown as T;
  return JSON.parse(serializeSignal(payload)) as T;
}
export const buildOpenSignal = (input: BuilderInput<OpenSignalPayload>): OpenSignalPayload =>
  buildSignal<OpenSignalPayload>({ ...input, action: 'open' });
export const buildUpdateSignal = (input: BuilderInput<UpdateSignalPayload>): UpdateSignalPayload =>
  buildSignal<UpdateSignalPayload>({ ...input, action: 'update' });
export const buildCancelSignal = (input: BuilderInput<CancelSignalPayload>): CancelSignalPayload =>
  buildSignal<CancelSignalPayload>({ ...input, action: 'cancel' });
export const buildCloseSignal = (input: BuilderInput<CloseSignalPayload>): CloseSignalPayload =>
  buildSignal<CloseSignalPayload>({ ...input, action: 'close' });
export const buildStartSignal = (input: BuilderInput<StartSignalPayload>): StartSignalPayload =>
  buildSignal<StartSignalPayload>({ ...input, action: 'start' });
export const buildPauseSignal = (input: BuilderInput<PauseSignalPayload>): PauseSignalPayload =>
  buildSignal<PauseSignalPayload>({ ...input, action: 'pause' });
export const buildStopSignal = (input: BuilderInput<StopSignalPayload>): StopSignalPayload =>
  buildSignal<StopSignalPayload>({ ...input, action: 'stop' });
export const buildDeleteSignal = (input: BuilderInput<DeleteSignalPayload>): DeleteSignalPayload =>
  buildSignal<DeleteSignalPayload>({ ...input, action: 'delete' });
