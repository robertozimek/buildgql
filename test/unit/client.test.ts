import { describe, expect, it, vi } from 'vitest';
import { leafField, objectField } from '../../src/runtime/builders.js';
import { makeQuery } from '../../src/runtime/operation.js';
import { createClient } from '../../src/client/index.js';
import { BuildQLError, BuildQLHttpError, BuildQLResponseError } from '../../src/client/errors.js';

const User = { id: leafField<'id', ['!'], string>('id', ['!']) };
const query = makeQuery({ users: objectField('users', ['!', 'l', '!'], User) });
const q = query('Users', ($, Q) => [Q.users((U) => [U.id])]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createClient', () => {
  it('POSTs the document and returns data', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: { users: [{ id: '1' }] } }));
    const client = createClient({ url: 'http://x/graphql', fetch: fetchMock });
    const result = await client.execute(q);
    expect(result).toEqual({ users: [{ id: '1' }] });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://x/graphql');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      query: 'query Users { users { id } }',
      operationName: 'Users',
      variables: {},
    });
  });

  it('resolves lazy headers per request', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: { users: [] } }));
    const client = createClient({
      url: 'http://x/graphql',
      headers: () => ({ authorization: 'Bearer t' }),
      fetch: fetchMock,
    });
    await client.execute(q);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer t');
  });

  it('throws BuildQLResponseError when the payload carries errors', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: null, errors: [{ message: 'boom', path: ['users'] }] }),
    );
    const client = createClient({ url: 'http://x/graphql', fetch: fetchMock as typeof fetch });
    await expect(client.execute(q)).rejects.toBeInstanceOf(BuildQLResponseError);
    await expect(client.execute(q)).rejects.toThrow('boom');
  });

  it('throws BuildQLHttpError on a non-2xx response', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    const client = createClient({ url: 'http://x/graphql', fetch: fetchMock as typeof fetch });
    await expect(client.execute(q)).rejects.toBeInstanceOf(BuildQLHttpError);
  });

  it('throws BuildQLHttpError with the raw body on an unparseable 200 response', async () => {
    const malformed = '{not valid json';
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(malformed, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const client = createClient({ url: 'http://x/graphql', fetch: fetchMock });

    const err = await client.execute(q).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BuildQLHttpError);
    expect((err as BuildQLHttpError).body).toBe(malformed);
  });

  it('merges per-request headers with client-level headers, per-request winning on conflict', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: { users: [] } }));
    const client = createClient({
      url: 'http://x/graphql',
      headers: { 'x-client-only': 'client', 'x-both': 'client' },
      fetch: fetchMock,
    });

    await client.execute(q, undefined, { headers: { 'x-request-only': 'request', 'x-both': 'request' } });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const sent = new Headers(init.headers);
    expect(sent.get('x-client-only')).toBe('client');
    expect(sent.get('x-request-only')).toBe('request');
    expect(sent.get('x-both')).toBe('request');
  });

  it('aborts the request when the passed signal is already aborted', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const signal = (init as RequestInit).signal;
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      return jsonResponse({ data: { users: [] } });
    });
    const client = createClient({ url: 'http://x/graphql', fetch: fetchMock });
    const controller = new AbortController();
    controller.abort();

    await expect(client.execute(q, undefined, { signal: controller.signal })).rejects.toThrow(/aborted/i);
  });

  it('forwards the signal through to fetch so an abort after the call is honored', async () => {
    let seenSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      seenSignal = (init as RequestInit).signal ?? undefined;
      return jsonResponse({ data: { users: [] } });
    });
    const client = createClient({ url: 'http://x/graphql', fetch: fetchMock });
    const controller = new AbortController();

    await client.execute(q, undefined, { signal: controller.signal });

    expect(seenSignal).toBe(controller.signal);
    expect(seenSignal?.aborted).toBe(false);
  });

  it('lets one instanceof check catch every buildql error', () => {
    expect(new BuildQLHttpError(500, 'boom')).toBeInstanceOf(BuildQLError);
    expect(new BuildQLResponseError([{ message: 'nope' }], undefined)).toBeInstanceOf(BuildQLError);
    expect(new BuildQLHttpError(500, 'boom').name).toBe('BuildQLHttpError');
    expect(new BuildQLResponseError([{ message: 'nope' }], undefined).name).toBe('BuildQLResponseError');
  });
});
