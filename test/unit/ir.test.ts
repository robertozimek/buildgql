import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../../src/codegen/introspect.js';
import { buildIR } from '../../src/codegen/ir.js';

const sdlPath = fileURLToPath(new URL('../fixtures/schema.graphql', import.meta.url));

async function ir() {
  return buildIR(await loadSchema(sdlPath));
}

describe('buildIR', () => {
  it('names the root types', async () => {
    const s = await ir();
    expect(s.queryType).toBe('Query');
    expect(s.mutationType).toBe('Mutation');
    expect(s.subscriptionType).toBe(null);
  });

  it('drops introspection types', async () => {
    const s = await ir();
    expect(s.types.some((t) => t.name.startsWith('__'))).toBe(false);
  });

  it('produces outer-to-inner wrapper tuples', async () => {
    const s = await ir();
    const query = s.types.find((t) => t.name === 'Query')!;
    // posts: [Post!]!
    expect(query.fields.find((f) => f.name === 'posts')!.type).toMatchObject({
      wrap: ['!', 'l', '!'],
      name: 'Post',
      kind: 'object',
    });
    // post(id: ID!): Post  -> nullable named type
    expect(query.fields.find((f) => f.name === 'post')!.type.wrap).toEqual([]);
  });

  it('marks nullable arguments optional and records GraphQL type strings', async () => {
    const s = await ir();
    const createUser = s.types.find((t) => t.name === 'Mutation')!.fields.find((f) => f.name === 'createUser')!;
    expect(createUser.args.map((a) => [a.name, a.gqlType, a.optional])).toEqual([
      ['name', 'String!', false],
      ['email', 'String!', false],
      ['age', 'Int', true],
    ]);
  });

  it('applies scalar overrides', async () => {
    const s = buildIR(await loadSchema(sdlPath), { ID: 'PostId' });
    expect(s.scalars.ID).toBe('PostId');
    expect(s.scalars.String).toBe('string');
  });
});
