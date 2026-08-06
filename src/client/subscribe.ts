import { BuildQLHttpError, GraphQLResponseError } from './errors.js';
import type { GraphQLFormattedError } from './errors.js';

export interface SubscribePayload {
  readonly query: string;
  readonly operationName: string;
  readonly variables: Record<string, unknown>;
}

export interface StreamChunk {
  readonly data?: unknown;
  readonly errors?: readonly GraphQLFormattedError[];
}

export interface SubscriptionTransport {
  /** `headers` carries per-subscription headers from `client.subscribe(op, vars, { headers })`. */
  subscribe(
    payload: SubscribePayload,
    signal: AbortSignal,
    headers?: HeadersInit,
  ): AsyncIterable<StreamChunk>;
}

export interface SseTransportOptions {
  readonly url: string;
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  readonly fetch?: typeof fetch;
}

/** Splits a byte stream into SSE events, buffering across chunk boundaries. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // Normalize CRLF to LF: SSE permits `\r\n` line endings, and real servers emit
    // them. Doing this at decode time (rather than splitting on a regex) also fixes
    // the per-line `event:`/`data:` parsing below, which only checks for `\n`.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      yield { event, data: dataLines.join('\n') };
      sep = buffer.indexOf('\n\n');
    }
  }
}

/** graphql-sse "distinct connections mode": one POST per subscription. */
export function sseTransport(opts: SseTransportOptions): SubscriptionTransport {
  const doFetch = opts.fetch ?? globalThis.fetch;
  return {
    async *subscribe(payload, signal, callHeaders) {
      const base = typeof opts.headers === 'function' ? await opts.headers() : (opts.headers ?? {});
      const headers = new Headers(base);
      // Per-subscription headers (from `client.subscribe(op, vars, { headers })`) override
      // the transport-level ones, mirroring how `execute`'s per-request headers win.
      for (const [k, val] of new Headers(callHeaders ?? {})) headers.set(k, val);
      headers.set('content-type', 'application/json');
      headers.set('accept', 'text/event-stream');

      const res = await doFetch(opts.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok || !res.body) {
        throw new BuildQLHttpError(res.status, await res.text().catch(() => ''));
      }
      let completed = false;
      for await (const evt of sseEvents(res.body)) {
        if (evt.event === 'complete') {
          completed = true;
          break;
        }
        if (evt.event !== 'next') continue;
        yield JSON.parse(evt.data) as StreamChunk;
      }
      // The stream ended (reader done, or a truncated trailing event was discarded)
      // without an explicit `complete` event. Treat that as an error rather than a
      // clean finish — otherwise a dropped connection is silently indistinguishable
      // from a subscription that legitimately has nothing more to send.
      if (!completed) {
        throw new Error('buildql: subscription stream ended before completing');
      }
    },
  };
}

export interface WsTransportOptions {
  readonly url: string;
  readonly connectionParams?:
    Record<string, unknown> | (() => Record<string, unknown> | Promise<Record<string, unknown>>);
  readonly WebSocket?: typeof WebSocket;
}

/** graphql-ws protocol: connection_init -> subscribe -> next* -> complete. */
export function wsTransport(opts: WsTransportOptions): SubscriptionTransport {
  const WS = opts.WebSocket ?? globalThis.WebSocket;
  return {
    // The standard `WebSocket` constructor has no way to set custom HTTP headers, so
    // per-subscription headers (the third `subscribe` parameter) cannot be honored
    // here — authenticate via `connectionParams` instead, which travels in the
    // `connection_init` message body.
    subscribe(payload, signal) {
      const queue: StreamChunk[] = [];
      let done = false;
      let completed = false;
      let aborted = false;
      let failure: Error | null = null;
      let wake: (() => void) | null = null;
      const notify = () => {
        wake?.();
        wake = null;
      };

      const socket = new WS(opts.url, 'graphql-transport-ws');
      const id = '1';

      socket.onopen = async () => {
        try {
          const params =
            typeof opts.connectionParams === 'function'
              ? await opts.connectionParams()
              : opts.connectionParams;
          // The signal may have aborted, or the socket may already have closed, while
          // we were awaiting `connectionParams()` above — sending on a socket that
          // isn't open throws synchronously on a real `WebSocket`. Since nothing awaits
          // `onopen`, an uncaught throw here would become an unhandled rejection in the
          // consuming app; route it through the same failure/notify path instead.
          if (socket.readyState !== WS.OPEN) return;
          socket.send(JSON.stringify({ type: 'connection_init', payload: params ?? {} }));
        } catch (err) {
          failure = err instanceof Error ? err : new Error(String(err));
          done = true;
          notify();
        }
      };
      socket.onmessage = (evt: MessageEvent) => {
        const msg = JSON.parse(String(evt.data)) as { type: string; payload?: unknown };
        if (msg.type === 'connection_ack') {
          socket.send(JSON.stringify({ id, type: 'subscribe', payload }));
        } else if (msg.type === 'next' && msg.payload) {
          queue.push(msg.payload);
          notify();
        } else if (msg.type === 'error') {
          // graphql-ws defines `payload` on an `error` message as `GraphQLFormattedError[]`
          // — surface it via the same error type the `next`-with-`errors` path uses,
          // instead of discarding the server's diagnostics.
          const errors: readonly GraphQLFormattedError[] = Array.isArray(msg.payload) ? msg.payload : [];
          failure = new GraphQLResponseError(errors, undefined);
          done = true;
          notify();
        } else if (msg.type === 'complete') {
          completed = true;
          done = true;
          notify();
        }
      };
      socket.onerror = () => {
        failure = new Error('buildql: subscription socket error');
        done = true;
        notify();
      };
      socket.onclose = () => {
        // An abnormal close (network drop, code 1006, ...) that never sent `complete`
        // is not a clean finish — without this it's silently indistinguishable from a
        // graceful shutdown. Don't override an already-recorded failure, and don't
        // flag it as truncated if we're the ones who closed it via `abort`.
        if (!completed && !aborted && !failure) {
          failure = new Error('buildql: subscription stream ended before completing');
        }
        done = true;
        notify();
      };
      signal.addEventListener('abort', () => {
        aborted = true;
        try {
          socket.send(JSON.stringify({ id, type: 'complete' }));
        } catch {
          /* socket already closed */
        }
        socket.close();
        done = true;
        notify();
      });

      return {
        async *[Symbol.asyncIterator]() {
          for (;;) {
            while (queue.length > 0) yield queue.shift()!;
            if (failure) throw failure;
            if (done) return;
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        },
      };
    },
  };
}
