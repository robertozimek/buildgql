import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../../src/codegen/introspect.js';
import { buildIR } from '../../src/codegen/ir.js';
import { emit } from '../../src/codegen/emit.js';
import type { IRSchema } from '../../src/codegen/ir.js';
import { DEFAULT_SCALARS } from '../../src/codegen/scalars.js';

const sdlPath = fileURLToPath(new URL('../fixtures/schema.graphql', import.meta.url));

async function generated() {
  return emit(buildIR(await loadSchema(sdlPath)));
}

describe('emit', () => {
  it('imports the runtime from the package root', async () => {
    expect(await generated()).toContain("from 'buildql'");
  });

  it('emits a field map per object type', async () => {
    const src = await generated();
    expect(src).toContain('export const Post = {');
    expect(src).toContain('export const User = {');
  });

  it('emits leaves with their wrapper tuples', async () => {
    const src = await generated();
    expect(src).toContain("id: leaf<'id', ['!'], string>('id', ['!'])");
    expect(src).toContain("lastName: leaf<'lastName', [], string>('lastName', [])");
  });

  it('emits object fields lazily so cyclic types resolve', async () => {
    const src = await generated();
    expect(src).toContain("get author() { return object('author', ['!'], User) }");
  });

  it('emits argument specs with GraphQL type strings and optional markers', async () => {
    const src = await generated();
    // `age: Int` is nullable in the schema, so it is optional AND accepts null.
    expect(src).toContain(
      "args<{ name: string; email: string; age?: number | null }>({ name: 'String!', email: 'String!', age: 'Int' })",
    );
  });

  it('binds the operation builders to the schema roots', async () => {
    const src = await generated();
    expect(src).toContain('export const query = makeQuery(Query)');
    expect(src).toContain('export const mutation = makeMutation(Mutation)');
    expect(src).not.toContain('makeSubscription(');
  });

  it('emits a fragment helper per object type', async () => {
    expect(await generated()).toContain("export const postFragment = makeFragment('Post', Post)");
  });

  it('emits enum key lists for enum arguments so literals print unquoted', () => {
    // Built by hand (rather than via the SDL fixture) to keep this regression
    // isolated to the enum-arg code path in `argSpec`.
    const schema: IRSchema = {
      queryType: 'Query',
      mutationType: null,
      subscriptionType: null,
      scalars: DEFAULT_SCALARS,
      types: [
        {
          name: 'Query',
          kind: 'object',
          description: null,
          possibleTypes: [],
          interfaces: [],
          enumValues: [],
          inputFields: [],
          fields: [
            {
              name: 'postsByStatus',
              type: { wrap: ['!', 'l', '!'], name: 'Post', kind: 'object' },
              gqlType: '[Post!]!',
              description: null,
              deprecated: null,
              args: [
                {
                  name: 'status',
                  type: { wrap: ['!'], name: 'Status', kind: 'enum' },
                  gqlType: 'Status!',
                  optional: false,
                },
              ],
            },
          ],
        },
        {
          name: 'Post',
          kind: 'object',
          description: null,
          possibleTypes: [],
          interfaces: [],
          enumValues: [],
          inputFields: [],
          fields: [
            {
              name: 'id',
              type: { wrap: ['!'], name: 'ID', kind: 'scalar' },
              gqlType: 'ID!',
              description: null,
              deprecated: null,
              args: [],
            },
          ],
        },
        {
          name: 'Status',
          kind: 'enum',
          description: null,
          possibleTypes: [],
          interfaces: [],
          enumValues: ['ACTIVE', 'BANNED'],
          inputFields: [],
          fields: [],
        },
      ],
    };
    const src = emit(schema);
    expect(src).toContain("args<{ status: Status }>({ status: 'Status!' }, ['status'])");
  });
});
