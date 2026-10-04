import { SdkError } from './errors.js';
import { object, validateResponse } from './validation.js';

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface TransportOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: Fetch;
  allowLocalHttp?: boolean;
}
export interface RequestOptions {
  signal?: AbortSignal;
}

export function baseUrl(options: TransportOptions): string {
  let url: URL;
  try {
    url = new URL(options.baseUrl ?? '');
  } catch {
    throw new SdkError('validation', 'baseUrl must be an absolute URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && local && options.allowLocalHttp === true))
  )
    throw new SdkError('validation', 'baseUrl requires HTTPS or explicitly allowed local HTTP');
  return url.href.replace(/\/$/, '');
}
function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return [String(value)];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (object(value)) return Object.values(value).flatMap(stringLeaves);
  return [];
}
export function validateCredential(secret: unknown): asserts secret is string {
  if (typeof secret !== 'string' || !secret || /[\r\n]/.test(secret))
    throw new SdkError('validation', 'A valid credential is required');
}
async function responseText(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  let completed = false;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    // Caller-provided streams can reject or never settle cancellation.
    try {
      void reader.cancel().catch(() => {});
    } catch {
      /* Cleanup must not replace the selected request error. */
    }
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error('aborted');
      const chunk = await reader.read();
      if (signal.aborted) throw new Error('aborted');
      if (chunk.done) {
        completed = true;
        return text + decoder.decode();
      }
      if (size + chunk.value.byteLength > 1_048_576)
        throw new SdkError('protocol', 'Response exceeds 1 MiB');
      size += chunk.value.byteLength;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!completed) cancel();
    try {
      reader.releaseLock();
    } catch {
      /* Preserve the error even when a custom reader rejects cleanup. */
    }
  }
}
export class Transport {
  readonly url: string;
  #fetch: Fetch;
  #timeout: number;
  #secret: string | undefined;
  constructor(options: TransportOptions, secret?: string) {
    this.url = baseUrl(options);
    if (secret !== undefined) validateCredential(secret);
    this.#secret = secret;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeout = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(this.#timeout) || this.#timeout <= 0 || this.#timeout > 2_147_483_647)
      throw new SdkError('validation', 'timeoutMs must be a positive bounded number');
  }
  async request(
    url: string,
    init: RequestInit,
    operation?: string,
    strategyKey?: string,
  ): Promise<Response> {
    if (typeof init.body === 'string' && new TextEncoder().encode(init.body).length > 16 * 1024)
      throw new SdkError('validation', 'Request body exceeds 16 KiB');
    const controller = new AbortController();
    const caller = init.signal;
    if (caller?.aborted) throw new SdkError('cancelled', 'Request was cancelled');
    const abort = () => controller.abort();
    caller?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeout);
    try {
      const response = await this.#fetch(url, {
        ...init,
        signal: controller.signal,
        redirect: 'manual',
      });
      const text = await responseText(response, controller.signal);
      if (controller.signal.aborted) throw new Error('aborted');
      if (!response.ok) {
        let details: unknown;
        try {
          details = JSON.parse(text);
        } catch {
          /* Infrastructure errors need no JSON body. */
        }
        const body = object(details) ? details : {};
        let sent: unknown;
        if (typeof init.body === 'string') {
          try {
            sent = JSON.parse(init.body);
          } catch {
            /* No request body diagnostics. */
          }
        }
        const credentials = [this.#secret, strategyKey, url].filter(
          (value): value is string => !!value,
        );
        const sensitive = [...credentials, ...stringLeaves(sent)]
          .filter(Boolean)
          .sort((a, b) => b.length - a.length);
        const clean = (value: unknown, submittedValues = true): string | undefined => {
          if (typeof value !== 'string') return undefined;
          let result = value;
          for (const secret of submittedValues ? sensitive : credentials)
            result = result.split(secret).join('[redacted]');
          return result
            .replace(/https?:\/\/\S+|Bearer\s+\S+|vt_[A-Za-z0-9_-]+/gi, '[redacted]')
            .replace(/[\r\n]/g, ' ')
            .slice(0, 512);
        };
        const message =
          clean(body['message'] ?? body['error']) ??
          'HTTP request failed (' + response.status + ')';
        const code = clean(body['errorCode'], false);
        const requestId = clean(
          typeof body['requestId'] === 'string'
            ? body['requestId']
            : response.headers.get('x-request-id'),
          false,
        );
        throw new SdkError('http', message, {
          status: response.status,
          ...(code ? { code } : {}),
          ...(requestId ? { requestId } : {}),
        });
      }
      if (operation) {
        if (response.status !== 200)
          throw new SdkError('protocol', 'Unexpected REST success status');
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          throw new SdkError('protocol', 'The server returned invalid JSON');
        }
        validateResponse(operation, body);
      } else if (response.status !== 204)
        throw new SdkError('protocol', 'Expected webhook enqueue acknowledgement (204)');
      return new Response(response.status === 204 ? null : text, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      if (error instanceof SdkError) throw error;
      if (timedOut) throw new SdkError('timeout', 'Request timed out; its outcome may be unknown');
      if (caller?.aborted)
        throw new SdkError('cancelled', 'Request was cancelled; its outcome may be unknown');
      throw new SdkError('transport', 'HTTP transport failed; its outcome may be unknown');
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener('abort', abort);
    }
  }
}
