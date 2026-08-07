import { AsyncQueue } from './async-queue.js';
import { BuildQLResponseError } from './errors.js';
import type { GraphQLFormattedError } from './errors.js';
import type { StreamChunk, SubscriptionTransport } from './transport.js';

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
      const queue = new AsyncQueue<StreamChunk>();
      let completed = false;
      let aborted = false;

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
          // consuming app; route it through the queue's failure path instead.
          if (socket.readyState !== WS.OPEN) return;
          socket.send(JSON.stringify({ type: 'connection_init', payload: params ?? {} }));
        } catch (err) {
          queue.fail(err instanceof Error ? err : new Error(String(err)));
        }
      };

      socket.onmessage = (evt: MessageEvent) => {
        const msg = JSON.parse(String(evt.data)) as { type: string; payload?: unknown };
        if (msg.type === 'connection_ack') {
          socket.send(JSON.stringify({ id, type: 'subscribe', payload }));
        } else if (msg.type === 'next' && msg.payload) {
          queue.push(msg.payload);
        } else if (msg.type === 'error') {
          // graphql-ws defines `payload` on an `error` message as `GraphQLFormattedError[]`
          // — surface it via the same error type the `next`-with-`errors` path uses,
          // instead of discarding the server's diagnostics.
          const errors: readonly GraphQLFormattedError[] = Array.isArray(msg.payload) ? msg.payload : [];
          queue.fail(new BuildQLResponseError(errors, undefined));
        } else if (msg.type === 'complete') {
          completed = true;
          queue.close();
        }
      };

      socket.onerror = () => {
        queue.fail(new Error('buildql: subscription socket error'));
      };

      socket.onclose = () => {
        // An abnormal close (network drop, code 1006, ...) that never sent `complete`
        // is not a clean finish — without this it's silently indistinguishable from a
        // graceful shutdown. `AsyncQueue.fail` ignores a second call, so an
        // already-recorded failure wins; and we don't flag truncation if we're the
        // ones who closed it via `abort`.
        if (!completed && !aborted) {
          queue.fail(new Error('buildql: subscription stream ended before completing'));
        }
        queue.close();
      };

      signal.addEventListener('abort', () => {
        aborted = true;
        try {
          socket.send(JSON.stringify({ id, type: 'complete' }));
        } catch {
          /* socket already closed */
        }
        socket.close();
        queue.close();
      });

      return queue;
    },
  };
}
