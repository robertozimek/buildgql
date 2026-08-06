import { expect, it, vi } from 'vitest';
import { leafField, objectField } from '../../src/runtime/builders.js';
import { makeSubscription } from '../../src/runtime/operation.js';
import { createClient } from '../../src/client/index.js';
import { sseTransport, wsTransport } from '../../src/client/subscribe.js';
import type { SubscriptionTransport } from '../../src/client/subscribe.js';
import { BuildQLHttpError } from '../../src/client/errors.js';

const Msg = { id: leafField<'id', ['!'], string>('id', ['!']) };
const subscription = makeSubscription({ messages: objectField('messages', ['!'], Msg) });
const s = subscription('Messages', ($, S) => [S.messages((M) => [M.id])]);

function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

it('yields each SSE next event as typed data', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    sseResponse([
      'event: next\ndata: {"data":{"messages":{"id":"1"}}}\n\n',
      'event: next\ndata: {"data":{"messages":{"id":"2"}}}\n\n',
      'event: complete\ndata: \n\n',
    ]),
  );
  const client = createClient({
    url: 'http://x/graphql',
    subscriptions: sseTransport({ url: 'http://x/graphql', fetch: fetchMock }),
  });

  const seen: string[] = [];
  for await (const chunk of client.subscribe(s)) seen.push(chunk.messages.id);
  expect(seen).toEqual(['1', '2']);
});

it('handles a data event split across chunk boundaries', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    sseResponse([
      'event: next\ndata: {"data":{"mess',
      'ages":{"id":"1"}}}\n\n',
      'event: complete\ndata: \n\n',
    ]),
  );
  const client = createClient({
    url: 'http://x/graphql',
    subscriptions: sseTransport({ url: 'http://x/graphql', fetch: fetchMock }),
  });

  const seen: string[] = [];
  for await (const chunk of client.subscribe(s)) seen.push(chunk.messages.id);
  expect(seen).toEqual(['1']);
});

it('parses CRLF-framed SSE events (real servers emit \\r\\n line endings)', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    sseResponse([
      'event: next\r\ndata: {"data":{"messages":{"id":"1"}}}\r\n\r\n',
      'event: next\r\ndata: {"data":{"messages":{"id":"2"}}}\r\n\r\n',
      'event: complete\r\ndata: \r\n\r\n',
    ]),
  );
  const client = createClient({
    url: 'http://x/graphql',
    subscriptions: sseTransport({ url: 'http://x/graphql', fetch: fetchMock }),
  });

  const seen: string[] = [];
  for await (const chunk of client.subscribe(s)) seen.push(chunk.messages.id);
  expect(seen).toEqual(['1', '2']);
});

it('throws instead of completing silently when an SSE stream ends mid-event', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    // No terminating `\n\n` and no `complete` event: the connection was dropped
    // mid-message rather than finishing cleanly.
    sseResponse(['event: next\ndata: {"data":{"mess']),
  );
  const client = createClient({
    url: 'http://x/graphql',
    subscriptions: sseTransport({ url: 'http://x/graphql', fetch: fetchMock }),
  });

  const drain = async () => {
    for await (const _chunk of client.subscribe(s)) {
      /* nothing should ever be yielded */
    }
  };
  await expect(drain()).rejects.toThrow('buildql: subscription stream ended before completing');
});

/**
 * Minimal fake implementing the full `WebSocket` interface (not a cast) so the
 * `graphql-ws` transport — which is constructed against `typeof WebSocket` — can
 * be driven deterministically: assign `.onopen`/`.onmessage` and call them by
 * hand instead of relying on a real socket or timers.
 */
class FakeWebSocket extends EventTarget implements WebSocket {
  static readonly CONNECTING = 0 as const;
  static readonly OPEN = 1 as const;
  static readonly CLOSING = 2 as const;
  static readonly CLOSED = 3 as const;
  static readonly instances: FakeWebSocket[] = [];

  readonly CONNECTING = 0 as const;
  readonly OPEN = 1 as const;
  readonly CLOSING = 2 as const;
  readonly CLOSED = 3 as const;

  binaryType: BinaryType = 'blob';
  readonly bufferedAmount = 0;
  readonly extensions = '';
  readonly protocol: string;
  readonly readyState = 1;
  readonly url: string;

  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;

  readonly sent: string[] = [];
  closed = false;

  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    this.url = String(url);
    this.protocol = Array.isArray(protocols) ? (protocols[0] ?? '') : (protocols ?? '');
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    // `send`'s signature mirrors the real `WebSocket.send`; in practice the client only
    // ever sends the JSON strings it builds itself, never the binary variants in the union.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    this.sent.push(String(data));
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }
}

/**
 * Same shape as `FakeWebSocket`, but `send` throws synchronously — reproducing what a
 * real `WebSocket` does when asked to send while closed (or before it ever finished
 * opening). Used to verify `onopen`'s guard against becoming an unhandled rejection.
 */
class ThrowingSendWebSocket extends FakeWebSocket {
  override send(): void {
    throw new Error('buildql: socket is not open');
  }
}

it('drives the graphql-ws handshake: connection_init -> ack -> subscribe -> next -> complete', async () => {
  FakeWebSocket.instances.length = 0;

  const client = createClient({
    url: 'http://x/graphql',
    subscriptions: wsTransport({
      url: 'ws://x/graphql',
      connectionParams: { token: 't' },
      WebSocket: FakeWebSocket,
    }),
  });

  const iterator = client.subscribe(s)[Symbol.asyncIterator]();
  const first = iterator.next();

  const socket = FakeWebSocket.instances[0];
  expect(socket.protocol).toBe('graphql-transport-ws');

  // The transport wires `onopen` before anything else — simulate the socket opening.
  await socket.onopen?.call(socket, new Event('open'));
  expect(JSON.parse(socket.sent[0])).toEqual({ type: 'connection_init', payload: { token: 't' } });

  // Server acknowledges the connection; the transport should immediately send `subscribe`.
  socket.emitMessage({ type: 'connection_ack' });
  expect(JSON.parse(socket.sent[1])).toEqual({
    id: '1',
    type: 'subscribe',
    payload: { query: s.document, operationName: s.name, variables: {} },
  });

  // Server sends a `next` message carrying data.
  socket.emitMessage({ type: 'next', id: '1', payload: { data: { messages: { id: '1' } } } });
  await expect(first).resolves.toEqual({ value: { messages: { id: '1' } }, done: false });

  // Server sends `complete`; the iterator should finish cleanly.
  const second = iterator.next();
  socket.emitMessage({ type: 'complete', id: '1' });
  await expect(second).resolves.toEqual({ value: undefined, done: true });
});

it('surfaces the server-provided detail from a WS `error` message', async () => {
  FakeWebSocket.instances.length = 0;

  const client = createClient({
    url: 'http://x/graphql',
    subscriptions: wsTransport({ url: 'ws://x/graphql', WebSocket: FakeWebSocket }),
  });

  const iterator = client.subscribe(s)[Symbol.asyncIterator]();
  const first = iterator.next();

  const socket = FakeWebSocket.instances[0];
  await socket.onopen?.call(socket, new Event('open'));
  socket.emitMessage({ type: 'connection_ack' });

  // graphql-ws defines `payload` on an `error` message as `GraphQLFormattedError[]`.
  socket.emitMessage({
    type: 'error',
    id: '1',
    payload: [{ message: 'Syntax Error: Unexpected Name "bogus"' }],
  });

  await expect(first).rejects.toMatchObject({
    name: 'BuildQLResponseError',
    message: expect.stringContaining('Syntax Error: Unexpected Name "bogus"'),
    errors: [{ message: 'Syntax Error: Unexpected Name "bogus"' }],
  });
});

it('throws when the WS socket closes without a complete message (abnormal close)', async () => {
  FakeWebSocket.instances.length = 0;

  const client = createClient({
    url: 'http://x/graphql',
    subscriptions: wsTransport({ url: 'ws://x/graphql', WebSocket: FakeWebSocket }),
  });

  const iterator = client.subscribe(s)[Symbol.asyncIterator]();
  const first = iterator.next();

  const socket = FakeWebSocket.instances[0];
  await socket.onopen?.call(socket, new Event('open'));
  socket.emitMessage({ type: 'connection_ack' });
  socket.emitMessage({ type: 'next', id: '1', payload: { data: { messages: { id: '1' } } } });
  await expect(first).resolves.toEqual({ value: { messages: { id: '1' } }, done: false });

  // The socket goes away (network drop, code 1006) without ever sending `complete`.
  const second = iterator.next();
  socket.onclose?.call(socket, new CloseEvent('close', { code: 1006, wasClean: false }));
  await expect(second).rejects.toThrow('buildql: subscription stream ended before completing');
});

it('does not leave an unhandled rejection when onopen fails to send, and surfaces the failure instead', async () => {
  FakeWebSocket.instances.length = 0;

  const client = createClient({
    url: 'http://x/graphql',
    subscriptions: wsTransport({ url: 'ws://x/graphql', WebSocket: ThrowingSendWebSocket }),
  });

  const iterator = client.subscribe(s)[Symbol.asyncIterator]();
  const first = iterator.next();
  const socket = FakeWebSocket.instances[0];

  // `onopen` fires the same way a real WebSocket would — nothing in the transport
  // awaits it. If the synchronous throw from `send` weren't caught, this `await`
  // would itself reject (and in a real app, nothing would be there to catch it).
  await expect(socket.onopen?.call(socket, new Event('open'))).resolves.toBeUndefined();
  await expect(first).rejects.toThrow('buildql: socket is not open');
});

it('yields a queued `next` value even when `complete` arrives in the same turn, before the consumer drains', async () => {
  FakeWebSocket.instances.length = 0;

  const client = createClient({
    url: 'http://x/graphql',
    subscriptions: wsTransport({ url: 'ws://x/graphql', WebSocket: FakeWebSocket }),
  });

  const iterator = client.subscribe(s)[Symbol.asyncIterator]();
  const first = iterator.next();

  const socket = FakeWebSocket.instances[0];
  await socket.onopen?.call(socket, new Event('open'));
  socket.emitMessage({ type: 'connection_ack' });

  // Both messages are delivered synchronously, before the consumer ever calls
  // `iterator.next()` again — the queue must be drained fully before `done` is
  // honored, or this `next` value would be lost.
  socket.emitMessage({ type: 'next', id: '1', payload: { data: { messages: { id: '1' } } } });
  socket.emitMessage({ type: 'complete', id: '1' });

  await expect(first).resolves.toEqual({ value: { messages: { id: '1' } }, done: false });
  await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
});

it('threads per-subscription headers to the transport, merged with (and overriding) client-level headers', async () => {
  const seenHeaders: Headers[] = [];
  const transport: SubscriptionTransport = {
    async *subscribe(_payload, _signal, headers) {
      seenHeaders.push(new Headers(headers ?? {}));
    },
  };
  const client = createClient({
    url: 'http://x/graphql',
    headers: { 'x-client-only': 'client', 'x-both': 'client' },
    subscriptions: transport,
  });

  for await (const _chunk of client.subscribe(s, undefined, {
    headers: { 'x-sub-only': 'sub', 'x-both': 'sub' },
  })) {
    /* nothing yielded by this transport */
  }

  expect(seenHeaders).toHaveLength(1);
  expect(seenHeaders[0]?.get('x-client-only')).toBe('client');
  expect(seenHeaders[0]?.get('x-sub-only')).toBe('sub');
  // Per-subscription headers win over client-level ones for the same key.
  expect(seenHeaders[0]?.get('x-both')).toBe('sub');
});

it('throws BuildQLHttpError (not a bare Error) when the SSE handshake fails with a non-2xx status', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response('nope', { status: 503 }));
  const client = createClient({
    url: 'http://x/graphql',
    subscriptions: sseTransport({ url: 'http://x/graphql', fetch: fetchMock }),
  });

  const drain = async () => {
    for await (const _chunk of client.subscribe(s)) {
      /* nothing should ever be yielded */
    }
  };
  const err = await drain().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(BuildQLHttpError);
  expect((err as BuildQLHttpError).status).toBe(503);
  expect((err as BuildQLHttpError).body).toBe('nope');
});

it('aborts the transport signal immediately when the caller signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();

  const seenSignals: AbortSignal[] = [];
  const transport: SubscriptionTransport = {
    async *subscribe(_payload, signal) {
      seenSignals.push(signal);
    },
  };
  const client = createClient({ url: 'http://x/graphql', subscriptions: transport });

  const seen: unknown[] = [];
  for await (const chunk of client.subscribe(s, undefined, { signal: controller.signal })) seen.push(chunk);

  expect(seen).toEqual([]);
  expect(seenSignals).toHaveLength(1);
  expect(seenSignals[0]?.aborted).toBe(true);
});
