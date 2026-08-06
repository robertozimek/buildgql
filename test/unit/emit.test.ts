import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../../src/codegen/introspect.js';
import { buildIR } from '../../src/codegen/ir.js';
import { emit, unmappedScalars } from '../../src/codegen/emit.js';
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

  it('falls back to `unknown` for an unmapped scalar named "valueOf", rather than splicing in the inherited Object.prototype member', () => {
    // Regression test for leafTsType/inputTsType: `ir.scalars` here is a plain object
    // (`DEFAULT_SCALARS` inherits from `Object.prototype`), so a bracket read of
    // `ir.scalars['valueOf']` without an own-property guard would resolve to
    // `Object.prototype.valueOf` (a function, not `undefined`) and defeat the `??
    // UNKNOWN_SCALAR` fallback entirely.
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
              name: 'weird',
              type: { wrap: ['!'], name: 'valueOf', kind: 'scalar' },
              gqlType: 'valueOf!',
              description: null,
              deprecated: null,
              args: [],
            },
          ],
        },
      ],
    };
    const src = emit(schema);
    expect(src).toContain("weird: leaf<'weird', ['!'], unknown>('weird', ['!'])");
  });

  it('types a union/interface __typename as the union of its possible types, not its own name', () => {
    // Built by hand so the union case is isolated: `possibleTypes` is what
    // `buildIR` already computes from introspection but the emitter used to ignore,
    // instead stamping the abstract type's own name — which collapses `Selected`
    // to `never` wherever `__typename` is selected alongside `on()` branches.
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
              name: 'pet',
              type: { wrap: ['!'], name: 'Pet', kind: 'union' },
              gqlType: 'Pet!',
              description: null,
              deprecated: null,
              args: [],
            },
          ],
        },
        {
          name: 'Pet',
          kind: 'union',
          description: null,
          possibleTypes: ['Dog', 'Cat'],
          interfaces: [],
          enumValues: [],
          inputFields: [],
          fields: [],
        },
        {
          name: 'Node',
          kind: 'interface',
          description: null,
          possibleTypes: [],
          interfaces: [],
          enumValues: [],
          inputFields: [],
          fields: [],
        },
        {
          name: 'Dog',
          kind: 'object',
          description: null,
          possibleTypes: [],
          interfaces: [],
          enumValues: [],
          inputFields: [],
          fields: [
            {
              name: 'breed',
              type: { wrap: ['!'], name: 'String', kind: 'scalar' },
              gqlType: 'String!',
              description: null,
              deprecated: null,
              args: [],
            },
          ],
        },
      ],
    };
    const src = emit(schema);
    // The union carries the union of its possible types...
    expect(src).toContain("__typename: leaf<'__typename', ['!'], 'Dog' | 'Cat'>('__typename', ['!'])");
    // ...an interface with no known possible types falls back to `string` rather
    // than the abstract type's own unreturnable name...
    expect(src).toContain("__typename: leaf<'__typename', ['!'], string>('__typename', ['!'])");
    // ...and a concrete object type still gets its own single literal name.
    expect(src).toContain("__typename: leaf<'__typename', ['!'], 'Dog'>('__typename', ['!'])");
  });
});

describe('unmappedScalars', () => {
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
            name: 'createdAt',
            type: { wrap: ['!'], name: 'DateTime', kind: 'scalar' },
            gqlType: 'DateTime!',
            description: null,
            deprecated: null,
            args: [],
          },
        ],
      },
      { name: 'DateTime', kind: 'scalar', description: null, possibleTypes: [], interfaces: [], enumValues: [], inputFields: [], fields: [] },
      { name: 'JSON', kind: 'scalar', description: null, possibleTypes: [], interfaces: [], enumValues: [], inputFields: [], fields: [] },
      { name: 'String', kind: 'scalar', description: null, possibleTypes: [], interfaces: [], enumValues: [], inputFields: [], fields: [] },
    ],
  };

  it('names every custom scalar with no entry in ir.scalars', () => {
    expect(unmappedScalars(schema)).toEqual(['DateTime', 'JSON']);
  });

  it('does not flag scalars covered by the default or configured mapping', () => {
    const mapped: IRSchema = { ...schema, scalars: { ...DEFAULT_SCALARS, DateTime: 'string', JSON: 'unknown' } };
    expect(unmappedScalars(mapped)).toEqual([]);
  });

  it('flags a scalar named "toString" as unmapped, even though `name in scalars` would resolve it via Object.prototype', () => {
    // Regression test: `scalars` here is a plain object (as `DEFAULT_SCALARS` is), so
    // it inherits `toString`/`valueOf`/`constructor` from `Object.prototype`. A
    // membership check using `in` (rather than `Object.hasOwn`) would treat those
    // names as "mapped" and never flag them.
    const withProtoNamedScalar: IRSchema = {
      ...schema,
      types: [
        ...schema.types,
        { name: 'toString', kind: 'scalar', description: null, possibleTypes: [], interfaces: [], enumValues: [], inputFields: [], fields: [] },
      ],
    };
    expect(unmappedScalars(withProtoNamedScalar)).toEqual(['DateTime', 'JSON', 'toString']);
  });
});

describe('emit — client option', () => {
  it('defaults to buildql: imports and re-exports createClient', async () => {
    const src = await generated();
    // Pins the whole sorted import block, not just `createClient`'s presence: this is the
    // plan's #1 binding constraint — `client: 'buildql'` output must stay byte-identical to
    // what the emitter produced before this feature existed, and a `toContain` on a single
    // line would pass even if the sorted list were reordered around it.
    expect(src).toContain(
      "import {\n  args,\n  createClient,\n  include,\n  leaf,\n  leafArgs,\n  makeFragment,\n" +
      "  makeMutation,\n  makeQuery,\n  makeSubscription,\n  object,\n  objectArgs,\n  on,\n" +
      "  skip,\n  spread,\n  $,\n  v,\n} from 'buildql';\n",
    );
    expect(src).toContain('  createClient,\n');
    expect(src).toContain('export { $, v, on, spread, include, skip, createClient };');
    expect(src).not.toContain('buildql/adapters');
  });

  it('emits the apollo adapter imports and re-exports', async () => {
    const src = emit(buildIR(await loadSchema(sdlPath)), 'apollo');
    expect(src).toContain(
      "import { apolloDocument, toApolloMutation, toApolloQuery } from 'buildql/adapters/apollo';",
    );
    expect(src).toContain(
      'export { $, v, on, spread, include, skip, apolloDocument, toApolloMutation, toApolloQuery };',
    );
    // buildql's own client must not be bound in when another one was chosen.
    expect(src).not.toContain('createClient');
  });

  it('emits the urql adapter imports and re-exports', async () => {
    const src = emit(buildIR(await loadSchema(sdlPath)), 'urql');
    expect(src).toContain("import { toUrqlArgs, urqlDocument } from 'buildql/adapters/urql';");
    expect(src).toContain('export { $, v, on, spread, include, skip, toUrqlArgs, urqlDocument };');
    expect(src).not.toContain('createClient');
  });

  it('binds no client at all for "none"', async () => {
    const src = emit(buildIR(await loadSchema(sdlPath)), 'none');
    expect(src).toContain('export { $, v, on, spread, include, skip };');
    expect(src).not.toContain('createClient');
    expect(src).not.toContain('buildql/adapters');
  });

  it('still emits the runtime builders and the Operation type re-export for every client', async () => {
    for (const client of ['buildql', 'apollo', 'urql', 'none'] as const) {
      const src = emit(buildIR(await loadSchema(sdlPath)), client);
      expect(src).toContain('  makeQuery,\n');
      expect(src).toContain("export type { Operation } from 'buildql';");
      expect(src).toContain('export const query = makeQuery(Query)');
    }
  });
});
