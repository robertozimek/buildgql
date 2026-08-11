import { BuildGQLHttpError } from './errors.js';
import { mergeHeaders, resolveHeaders } from './headers.js';
import type { HeadersSource } from './headers.js';
import type { StreamChunk, SubscriptionTransport } from './transport.js';

export interface SseTransportOptions {
  readonly url: string;
  readonly headers?: HeadersSource;
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
      // Per-subscription headers (from `client.subscribe(op, vars, { headers })`) override
      // the transport-level ones, mirroring how `execute`'s per-request headers win.
      const headers = mergeHeaders(await resolveHeaders(opts.headers), callHeaders);
      headers.set('content-type', 'application/json');
      headers.set('accept', 'text/event-stream');

      const res = await doFetch(opts.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok || !res.body) {
        throw new BuildGQLHttpError(res.status, await res.text().catch(() => ''));
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
        throw new Error('buildgql: subscription stream ended before completing');
      }
    },
  };
}
