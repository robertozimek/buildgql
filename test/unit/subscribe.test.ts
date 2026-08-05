import { expect, it, vi } from 'vitest';
import { leaf, object } from '../../src/runtime/builders.js';
import { makeSubscription } from '../../src/runtime/operation.js';
import { createClient } from '../../src/client/client.js';
import { sseTransport, wsTransport } from '../../src/client/subscribe.js';

const Msg = { id: leaf<'id', ['!'], string>('id', ['!']) };
const subscription = makeSubscription({ messages: object('messages', ['!'], Msg) });
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
    sseResponse(['event: next\ndata: {"data":{"mess', 'ages":{"id":"1"}}}\n\n', 'event: complete\ndata: \n\n']),
  );
  const client = createClient({
    url: 'http://x/graphql',
    subscriptions: sseTransport({ url: 'http://x/graphql', fetch: fetchMock }),
  });

  const seen: string[] = [];
  for await (const chunk of client.subscribe(s)) seen.push(chunk.messages.id);
  expect(seen).toEqual(['1']);
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
    this.sent.push(String(data));
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }));
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
