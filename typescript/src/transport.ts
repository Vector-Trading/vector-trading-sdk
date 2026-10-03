import { SdkError } from './errors.js';
import { object, validateResponse } from './validation.js';

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface TransportOptions {
  baseUrl: string;
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
    url = new URL(options.baseUrl);
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
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (object(value)) return Object.values(value).flatMap(stringLeaves);
  return [];
}
export class Transport {
  readonly url: string;
  #fetch: Fetch;
  #timeout: number;
  #secret: string;
  constructor(options: TransportOptions, secret: string) {
    this.url = baseUrl(options);
    if (typeof secret !== 'string' || !secret || /[\r\n]/.test(secret))
      throw new SdkError('validation', 'A valid credential is required');
    this.#secret = secret;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeout = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(this.#timeout) || this.#timeout <= 0 || this.#timeout > 2_147_483_647)
      throw new SdkError('validation', 'timeoutMs must be a positive bounded number');
  }
  async request(url: string, init: RequestInit, operation?: string): Promise<Response> {
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
      const text = await response.text();
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
        const sensitive = [this.#secret, url, ...stringLeaves(sent)]
          .filter(Boolean)
          .sort((a, b) => b.length - a.length);
        const clean = (value: unknown, submittedValues = true): string | undefined => {
          if (typeof value !== 'string') return undefined;
          let result = value;
          for (const secret of submittedValues ? sensitive : [this.#secret, url])
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
        const requestId = clean(body['requestId'] ?? response.headers.get('x-request-id'), false);
        throw new SdkError('http', message, {
          status: response.status,
          ...(code ? { code } : {}),
          ...(requestId ? { requestId } : {}),
        });
      }
      if (operation) {
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
