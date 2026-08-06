import type { Operation } from '../runtime/operation.js';
import type { HasVars } from '../types/vars.js';
import { BuildQLHttpError, BuildQLResponseError } from './errors.js';
import type { GraphQLFormattedError } from './errors.js';
import type { SubscriptionTransport } from './subscribe.js';

export { sseTransport, wsTransport } from './subscribe.js';
export { BuildQLError, BuildQLHttpError, BuildQLResponseError } from './errors.js';
export type { GraphQLFormattedError } from './errors.js';
export type {
  SseTransportOptions,
  StreamChunk,
  SubscriptionTransport,
  WsTransportOptions,
} from './subscribe.js';

export interface ClientOptions {
  readonly url: string;
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  readonly fetch?: typeof fetch;
  readonly subscriptions?: SubscriptionTransport;
}

export interface ExecuteOptions {
  readonly signal?: AbortSignal;
  readonly headers?: HeadersInit;
}

type VarArgs<V> =
  HasVars<V> extends true
    ? [vars: NoInfer<V>, opts?: ExecuteOptions]
    : [vars?: NoInfer<V>, opts?: ExecuteOptions];

interface RawResponse {
  data?: unknown;
  errors?: readonly GraphQLFormattedError[];
}

export interface Client {
  execute<R, V>(op: Operation<R, V>, ...rest: VarArgs<V>): Promise<R>;
  subscribe<R, V>(op: Operation<R, V>, ...rest: VarArgs<V>): AsyncIterable<R>;
  readonly options: ClientOptions;
}

async function resolveHeaders(h: ClientOptions['headers']): Promise<HeadersInit> {
  if (!h) return {};
  return typeof h === 'function' ? await h() : h;
}

export function createClient(options: ClientOptions): Client {
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error('buildql: no fetch implementation available — pass one via createClient({ fetch })');
  }

  return {
    options,
    async execute<R, V>(op: Operation<R, V>, ...rest: VarArgs<V>): Promise<R> {
      const [vars, opts] = rest as [V | undefined, ExecuteOptions | undefined];
      const headers = new Headers(await resolveHeaders(options.headers));
      for (const [k, val] of new Headers(opts?.headers ?? {})) headers.set(k, val);
      headers.set('content-type', 'application/json');
      if (!headers.has('accept')) headers.set('accept', 'application/json');

      const res = await doFetch(options.url, {
        method: 'POST',
        headers,
        // `RequestInit.signal` is `AbortSignal | null`; `??` bridges our `undefined`.
        signal: opts?.signal ?? null,
        body: JSON.stringify({
          query: op.document,
          operationName: op.name,
          variables: vars ?? {},
        }),
      });

      if (!res.ok) throw new BuildQLHttpError(res.status, await res.text().catch(() => ''));

      // Read the body ONCE as text and parse it by hand. Calling `res.json()` and
      // then falling back to `res.text()` in the catch cannot work: the stream is
      // already consumed, the second read throws "Body is unusable", and the error
      // ends up carrying an empty `body` — exactly the diagnostic it exists to give.
      const raw = await res.text();
      let payload: RawResponse;
      try {
        payload = JSON.parse(raw) as RawResponse;
      } catch {
        throw new BuildQLHttpError(res.status, raw);
      }

      if (payload.errors && payload.errors.length > 0) {
        throw new BuildQLResponseError(payload.errors, payload.data);
      }
      return payload.data as R;
    },

    subscribe<R, V>(op: Operation<R, V>, ...rest: VarArgs<V>): AsyncIterable<R> {
      const transport = options.subscriptions;
      if (!transport) {
        throw new Error('buildql: createClient({ subscriptions }) is required to run subscriptions');
      }
      const [vars, opts] = rest as [V | undefined, ExecuteOptions | undefined];
      const controller = new AbortController();
      if (opts?.signal) {
        if (opts.signal.aborted) controller.abort();
        else opts.signal.addEventListener('abort', () => controller.abort());
      }
      const payload = {
        query: op.document,
        operationName: op.name,
        variables: (vars ?? {}) as Record<string, unknown>,
      };
      return {
        async *[Symbol.asyncIterator]() {
          // Deliberately NOT routed through the shared `resolveHeaders` helper: calling
          // an `async function` always returns a Promise, and `await`-ing it — even when
          // the value is already resolved — always defers by a microtask. Some transports
          // (`wsTransport`) construct their connection synchronously as part of this same
          // turn, so an unconditional `await` here would delay that connection by a tick
          // for every subscription, not just ones with a headers function to resolve.
          const headers = new Headers(
            typeof options.headers === 'function' ? await options.headers() : (options.headers ?? {}),
          );
          for (const [k, val] of new Headers(opts?.headers ?? {})) headers.set(k, val);
          for await (const chunk of transport.subscribe(payload, controller.signal, headers)) {
            if (chunk.errors && chunk.errors.length > 0) {
              throw new BuildQLResponseError(chunk.errors, chunk.data);
            }
            yield chunk.data as R;
          }
        },
      };
    },
  };
}
