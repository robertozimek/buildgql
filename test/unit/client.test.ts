import { describe, expect, it, vi } from 'vitest';
import { leaf, object } from '../../src/runtime/builders.js';
import { makeQuery } from '../../src/runtime/operation.js';
import { createClient } from '../../src/client/client.js';
import { BuildQLHttpError, GraphQLResponseError } from '../../src/client/errors.js';

const User = { id: leaf<'id', ['!'], string>('id', ['!']) };
const query = makeQuery({ users: object('users', ['!', 'l', '!'], User) });
const q = query('Users', ($, Q) => [Q.users((U) => [U.id])]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createClient', () => {
  it('POSTs the document and returns data', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: { users: [{ id: '1' }] } }));
    const client = createClient({ url: 'http://x/graphql', fetch: fetchMock as unknown as typeof fetch });
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
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.execute(q);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer t');
  });

  it('throws GraphQLResponseError when the payload carries errors', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: null, errors: [{ message: 'boom', path: ['users'] }] }),
    );
    const client = createClient({ url: 'http://x/graphql', fetch: fetchMock as unknown as typeof fetch });
    await expect(client.execute(q)).rejects.toBeInstanceOf(GraphQLResponseError);
    await expect(client.execute(q)).rejects.toThrow('boom');
  });

  it('throws BuildQLHttpError on a non-2xx response', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    const client = createClient({ url: 'http://x/graphql', fetch: fetchMock as unknown as typeof fetch });
    await expect(client.execute(q)).rejects.toBeInstanceOf(BuildQLHttpError);
  });
});
