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
  subscribe(payload: SubscribePayload, signal: AbortSignal): AsyncIterable<StreamChunk>;
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
    buffer += decoder.decode(value, { stream: true });
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
    async *subscribe(payload, signal) {
      const base = typeof opts.headers === 'function' ? await opts.headers() : (opts.headers ?? {});
      const headers = new Headers(base);
      headers.set('content-type', 'application/json');
      headers.set('accept', 'text/event-stream');

      const res = await doFetch(opts.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`buildql: subscription failed with HTTP ${res.status}`);
      }
      for await (const evt of sseEvents(res.body)) {
        if (evt.event === 'complete') return;
        if (evt.event !== 'next') continue;
        yield JSON.parse(evt.data) as StreamChunk;
      }
    },
  };
}

export interface WsTransportOptions {
  readonly url: string;
  readonly connectionParams?: Record<string, unknown> | (() => Record<string, unknown> | Promise<Record<string, unknown>>);
  readonly WebSocket?: typeof WebSocket;
}

/** graphql-ws protocol: connection_init -> subscribe -> next* -> complete. */
export function wsTransport(opts: WsTransportOptions): SubscriptionTransport {
  const WS = opts.WebSocket ?? globalThis.WebSocket;
  return {
    subscribe(payload, signal) {
      const queue: StreamChunk[] = [];
      let done = false;
      let failure: Error | null = null;
      let wake: (() => void) | null = null;
      const notify = () => {
        wake?.();
        wake = null;
      };

      const socket = new WS(opts.url, 'graphql-transport-ws');
      const id = '1';

      socket.onopen = async () => {
        const params =
          typeof opts.connectionParams === 'function' ? await opts.connectionParams() : opts.connectionParams;
        socket.send(JSON.stringify({ type: 'connection_init', payload: params ?? {} }));
      };
      socket.onmessage = (evt: MessageEvent) => {
        const msg = JSON.parse(String(evt.data)) as { type: string; payload?: StreamChunk };
        if (msg.type === 'connection_ack') {
          socket.send(JSON.stringify({ id, type: 'subscribe', payload }));
        } else if (msg.type === 'next' && msg.payload) {
          queue.push(msg.payload);
          notify();
        } else if (msg.type === 'error') {
          failure = new Error('buildql: subscription error');
          done = true;
          notify();
        } else if (msg.type === 'complete') {
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
        done = true;
        notify();
      };
      signal.addEventListener('abort', () => {
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
