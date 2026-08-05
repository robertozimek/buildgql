import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { INTROSPECTION_QUERY, loadSchema } from '../../src/codegen/introspect.js';

const sdlPath = fileURLToPath(new URL('../fixtures/schema.graphql', import.meta.url));

describe('loadSchema', () => {
  it('reads an SDL file', async () => {
    const schema = await loadSchema(sdlPath);
    const names = schema.__schema.types.map((t) => t.name);
    expect(names).toContain('Post');
    expect(names).toContain('User');
    expect(schema.__schema.queryType.name).toBe('Query');
  });

  it('introspects a URL and sends the introspection query', async () => {
    const sdlSchema = await loadSchema(sdlPath);
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ data: sdlSchema }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const schema = await loadSchema('https://api.example.com/graphql', {
      headers: { authorization: 'Bearer t' },
      fetch: fetchMock,
    });
    expect(schema.__schema.queryType.name).toBe('Query');

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string).query).toBe(INTROSPECTION_QUERY);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer t');
  });

  it('reads a JSON introspection file and unwraps a data envelope', async () => {
    const sdlSchema = await loadSchema(sdlPath);
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'buildql-'));
    const file = join(dir, 'schema.json');
    await writeFile(file, JSON.stringify({ data: sdlSchema }));
    const schema = await loadSchema(file);
    expect(schema.__schema.queryType.name).toBe('Query');
  });

  it('reports a helpful error when introspection returns errors', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ errors: [{ message: 'introspection disabled' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      loadSchema('https://api.example.com/graphql', { fetch: fetchMock }),
    ).rejects.toThrow(/introspection disabled/);
  });
});
