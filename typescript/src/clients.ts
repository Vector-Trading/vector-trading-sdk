import {
  DefaultApi,
  type ListBundlesRequest,
  type SearchUsersRequest,
  type GetCheckoutRequest,
  type ListBundleUsersRequest,
  type ListBundleGrantsRequest,
  type CreateBundleGrantRequest,
  type RevokeBundleGrantRequest,
} from '../../generation/generated/typescript/apis/DefaultApi.js';
import { Configuration, FetchError } from '../../generation/generated/typescript/runtime.js';
import type { SignalPayload } from '../../generation/generated/typescript/models/SignalPayload.js';
import { SdkError } from './errors.js';
import { serializeSignal } from './signals.js';
import { Transport, type TransportOptions, type RequestOptions } from './transport.js';
import { object, validateModel, validateParameters } from './validation.js';

export interface RestClientOptions extends TransportOptions {
  accountApiKey: string;
}
export interface SignalsClientOptions extends TransportOptions {
  strategyApiKey: string;
}

export class RestClient {
  #transport: Transport;
  #key: string;
  constructor(options: RestClientOptions) {
    this.#transport = new Transport(options, options.accountApiKey);
    this.#key = options.accountApiKey;
  }
  async #call<T>(
    operation: string,
    parameters: Record<string, unknown>,
    options: RequestOptions,
    call: (api: DefaultApi, init: RequestInit) => Promise<T>,
  ): Promise<T> {
    validateParameters(operation, parameters);
    const api = new DefaultApi(
      new Configuration({
        basePath: this.#transport.url,
        accessToken: this.#key,
        fetchApi: (url, init) => this.#transport.request(String(url), init ?? {}, operation),
      }),
    );
    try {
      return await call(api, options.signal ? { signal: options.signal } : {});
    } catch (error) {
      if (error instanceof SdkError) throw error;
      if (error instanceof FetchError && error.cause instanceof SdkError) throw error.cause;
      throw new SdkError(
        'protocol',
        'The generated client could not process the request or response',
      );
    }
  }
  listBundles(parameters: ListBundlesRequest = {}, options: RequestOptions = {}) {
    return this.#call('listBundles', { ...parameters }, options, (api, init) =>
      api.listBundles(parameters, init),
    );
  }
  searchUsers(parameters: SearchUsersRequest, options: RequestOptions = {}) {
    return this.#call('searchUsers', { ...parameters }, options, (api, init) =>
      api.searchUsers(parameters, init),
    );
  }
  getCheckout(parameters: GetCheckoutRequest, options: RequestOptions = {}) {
    return this.#call('getCheckout', { ...parameters }, options, (api, init) =>
      api.getCheckout(parameters, init),
    );
  }
  listBundleUsers(parameters: ListBundleUsersRequest, options: RequestOptions = {}) {
    return this.#call('listBundleUsers', { ...parameters }, options, (api, init) =>
      api.listBundleUsers(parameters, init),
    );
  }
  listBundleGrants(parameters: ListBundleGrantsRequest, options: RequestOptions = {}) {
    return this.#call('listBundleGrants', { ...parameters }, options, (api, init) =>
      api.listBundleGrants(parameters, init),
    );
  }
  async createBundleGrant(parameters: CreateBundleGrantRequest, options: RequestOptions = {}) {
    if (!object(parameters))
      throw new SdkError('validation', 'Request parameters must be an object');
    validateModel('CreateGrantRequest', parameters.createGrantRequest);
    return this.#call('createBundleGrant', { ...parameters }, options, (api, init) =>
      api.createBundleGrant(parameters, init),
    );
  }
  revokeBundleGrant(parameters: RevokeBundleGrantRequest, options: RequestOptions = {}) {
    return this.#call('revokeBundleGrant', { ...parameters }, options, (api, init) =>
      api.revokeBundleGrant(parameters, init),
    );
  }
  async *#pages<T extends { nextCursor?: string | undefined }>(
    parameters: { cursor?: string },
    options: RequestOptions,
    load: (cursor: string | undefined) => Promise<T>,
  ): AsyncGenerator<T> {
    let cursor = parameters.cursor;
    const seen = new Set<string>();
    if (cursor !== undefined) seen.add(cursor);
    while (true) {
      if (options.signal?.aborted) throw new SdkError('cancelled', 'Traversal was cancelled');
      const page = await load(cursor);
      yield page;
      if (page.nextCursor === undefined) return;
      if (seen.has(page.nextCursor))
        throw new SdkError('pagination', 'Server repeated a pagination cursor');
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }
  listBundlesPages(parameters: ListBundlesRequest = {}, options: RequestOptions = {}) {
    return this.#pages(parameters, options, (cursor) =>
      this.listBundles({ ...parameters, ...(cursor === undefined ? {} : { cursor }) }, options),
    );
  }
  searchUsersPages(parameters: SearchUsersRequest, options: RequestOptions = {}) {
    return this.#pages(parameters, options, (cursor) =>
      this.searchUsers({ ...parameters, ...(cursor === undefined ? {} : { cursor }) }, options),
    );
  }
  listBundleUsersPages(parameters: ListBundleUsersRequest, options: RequestOptions = {}) {
    return this.#pages(parameters, options, (cursor) =>
      this.listBundleUsers({ ...parameters, ...(cursor === undefined ? {} : { cursor }) }, options),
    );
  }
  listBundleGrantsPages(parameters: ListBundleGrantsRequest, options: RequestOptions = {}) {
    return this.#pages(parameters, options, (cursor) =>
      this.listBundleGrants(
        { ...parameters, ...(cursor === undefined ? {} : { cursor }) },
        options,
      ),
    );
  }
}

export class SignalsClient {
  #transport: Transport;
  #url: string;
  constructor(options: SignalsClientOptions) {
    if (!/^[a-f0-9]{32}$/.test(options.strategyApiKey))
      throw new SdkError(
        'validation',
        'strategyApiKey must be 32 lowercase hexadecimal characters',
      );
    this.#transport = new Transport(options, options.strategyApiKey);
    this.#url = this.#transport.url + '/webhooks/signals/v1/' + options.strategyApiKey;
  }
  async send(payload: SignalPayload, options: RequestOptions = {}): Promise<void> {
    const body = serializeSignal(payload);
    await this.#transport.request(this.#url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }
}
