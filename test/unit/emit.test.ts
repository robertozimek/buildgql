import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../../src/codegen/introspect.js';
import { buildIR } from '../../src/codegen/ir.js';
import { emit } from '../../src/codegen/emit.js';
import { unmappedScalars } from '../../src/codegen/ts-types.js';
import type { IRSchema } from '../../src/codegen/ir.js';
import { DEFAULT_SCALAR_MAPPINGS, EMPTY_SCALAR_PRELUDE, resolveScalars } from '../../src/codegen/scalars.js';
import type { ScalarConfig } from '../../src/codegen/scalars.js';

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
    expect(src).toContain("id: leafField<'id', ['!'], string>('id', ['!'])");
    expect(src).toContain("lastName: leafField<'lastName', [], string>('lastName', [])");
  });

  it('emits object fields lazily so cyclic types resolve', async () => {
    const src = await generated();
    expect(src).toContain("get author() { return objectField('author', ['!'], User) }");
  });

  it('emits argument specs with GraphQL type strings and optional markers', async () => {
    const src = await generated();
    // `age: Int` is nullable in the schema, so it is optional AND accepts null.
    expect(src).toContain(
      "argSpec<{ name: string; email: string; age?: number | null }>({ name: 'String!', email: 'String!', age: 'Int' })",
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
      scalars: DEFAULT_SCALAR_MAPPINGS,
      scalarPrelude: EMPTY_SCALAR_PRELUDE,
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
    expect(src).toContain("argSpec<{ status: Status }>({ status: 'Status!' }, ['status'])");
  });

  it('emits leafFieldArgs for a scalar field that takes arguments', () => {
    // Built by hand because no fixture schema has one: every args-bearing field in
    // `test/fixtures/schema.graphql` and the e2e server is composite, so the
    // `leafFieldArgs` branch of `emitField` would otherwise never execute — a typo
    // confined to that one template literal would keep the whole suite green while
    // every consumer with an everyday `avatar(size: Int): String` field got a module
    // importing a name it never calls.
    const schema: IRSchema = {
      queryType: 'Query',
      mutationType: null,
      subscriptionType: null,
      scalars: DEFAULT_SCALAR_MAPPINGS,
      scalarPrelude: EMPTY_SCALAR_PRELUDE,
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
              name: 'avatar',
              type: { wrap: [], name: 'String', kind: 'scalar' },
              gqlType: 'String',
              description: null,
              deprecated: null,
              args: [
                {
                  name: 'size',
                  type: { wrap: ['!'], name: 'Int', kind: 'scalar' },
                  gqlType: 'Int!',
                  optional: false,
                },
              ],
            },
          ],
        },
      ],
    };
    const src = emit(schema);
    // Pinned as one whole line: the builder name, both occurrences of the field name,
    // both wrapper tuples, the result type, the argument object type and the arg spec
    // all come from the same template literal, so any typo inside it fails here.
    expect(src).toContain(
      "  avatar: leafFieldArgs<'avatar', [], string, { size: number }>('avatar', [], argSpec<{ size: number }>({ size: 'Int!' })),",
    );
    // It must be the leaf-with-args builder, never the composite one.
    expect(src).not.toContain("objectFieldArgs('avatar'");
  });

  it('emits an interface per input object and binds the subscription root', () => {
    // Built by hand for the same reason as the `leafFieldArgs` test above, and it is the
    // same hole: before this test, `emitInput` was never CALLED at all. Neither
    // `test/fixtures/schema.graphql` nor the e2e server declares an input object or a
    // subscription root, so `grep -rn "kind: 'input'" test/` and every `subscriptionType`
    // in `test/` came back empty and null respectively — a typo confined to either of
    // those two template literals kept `npm run check` fully green while every consumer
    // with an input object or a subscription got a broken generated module.
    //
    // Deliberately NOT added to the shared SDL fixture: `test/unit/cli.test.ts` and the
    // e2e suite both pin that file's contents.
    const schema: IRSchema = {
      queryType: 'Query',
      mutationType: null,
      subscriptionType: 'Subscription',
      scalars: DEFAULT_SCALAR_MAPPINGS,
      scalarPrelude: EMPTY_SCALAR_PRELUDE,
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
              name: 'posts',
              type: { wrap: ['!', 'l', '!'], name: 'Post', kind: 'object' },
              gqlType: '[Post!]!',
              description: null,
              deprecated: null,
              args: [
                {
                  name: 'filter',
                  type: { wrap: [], name: 'PostFilter', kind: 'input' },
                  gqlType: 'PostFilter',
                  optional: true,
                },
              ],
            },
          ],
        },
        {
          name: 'Subscription',
          kind: 'object',
          description: null,
          possibleTypes: [],
          interfaces: [],
          enumValues: [],
          inputFields: [],
          fields: [
            {
              name: 'postAdded',
              type: { wrap: ['!'], name: 'Post', kind: 'object' },
              gqlType: 'Post!',
              description: null,
              deprecated: null,
              args: [],
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
          // One required scalar, one OPTIONAL field, one LIST field, and one reference to
          // another input object — between them these cover every branch `emitInput` and
          // the `inputTsType` it calls can take on a field.
          name: 'PostFilter',
          kind: 'input',
          description: null,
          possibleTypes: [],
          interfaces: [],
          enumValues: [],
          fields: [],
          inputFields: [
            {
              name: 'title',
              type: { wrap: ['!'], name: 'String', kind: 'scalar' },
              gqlType: 'String!',
              optional: false,
            },
            {
              name: 'tags',
              type: { wrap: ['l', '!'], name: 'String', kind: 'scalar' },
              gqlType: '[String!]',
              optional: true,
            },
            {
              name: 'author',
              type: { wrap: ['!'], name: 'AuthorFilter', kind: 'input' },
              gqlType: 'AuthorFilter!',
              optional: false,
            },
          ],
        },
        {
          name: 'AuthorFilter',
          kind: 'input',
          description: null,
          possibleTypes: [],
          interfaces: [],
          enumValues: [],
          fields: [],
          inputFields: [
            {
              name: 'name',
              type: { wrap: [], name: 'String', kind: 'scalar' },
              gqlType: 'String',
              optional: true,
            },
          ],
        },
      ],
    };
    const src = emit(schema);

    // Pinned as whole blocks, not line fragments: the `export interface` keyword, the type
    // name, every field name, the `?` optional marker and each mapped TypeScript type all
    // come from one template literal in `emitInput`, so any typo inside it fails here.
    expect(src).toContain(
      'export interface PostFilter {\n  title: string;\n  tags?: string[] | null;\n  author: AuthorFilter;\n}\n',
    );
    expect(src).toContain('export interface AuthorFilter {\n  name?: string | null;\n}\n');

    // The interface must be the same name the argument type refers to — emitting a correct
    // interface under a name nothing references would still be a broken module.
    expect(src).toContain(
      "  get posts() { return objectFieldArgs('posts', ['!', 'l', '!'], Post, argSpec<{ filter?: PostFilter | null }>({ filter: 'PostFilter' })) },",
    );

    // An input object is not composite: it gets an interface and nothing else — no field
    // map, and no fragment helper (a fragment on an input type is not valid GraphQL).
    expect(src).not.toContain('export const PostFilter = {');
    expect(src).not.toContain("makeFragment('PostFilter'");

    // The subscription root binding, which no fixture in this repo has a schema for.
    expect(src).toContain('export const subscription = makeSubscription(Subscription);');
  });

  it('falls back to `unknown` for an unmapped scalar named "valueOf", rather than splicing in the inherited Object.prototype member', () => {
    // Regression test for leafTsType/inputTsType: `ir.scalars` here is a plain object
    // (`DEFAULT_SCALAR_MAPPINGS` inherits from `Object.prototype`), so a bracket read of
    // `ir.scalars['valueOf']` without an own-property guard would resolve to
    // `Object.prototype.valueOf` (a function, not `undefined`) and defeat the `??
    // UNKNOWN_SCALAR` fallback entirely.
    const schema: IRSchema = {
      queryType: 'Query',
      mutationType: null,
      subscriptionType: null,
      scalars: DEFAULT_SCALAR_MAPPINGS,
      scalarPrelude: EMPTY_SCALAR_PRELUDE,
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
    expect(src).toContain("weird: leafField<'weird', ['!'], unknown>('weird', ['!'])");
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
      scalars: DEFAULT_SCALAR_MAPPINGS,
      scalarPrelude: EMPTY_SCALAR_PRELUDE,
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
    expect(src).toContain("__typename: leafField<'__typename', ['!'], 'Dog' | 'Cat'>('__typename', ['!'])");
    // ...an interface with no known possible types falls back to `string` rather
    // than the abstract type's own unreturnable name...
    expect(src).toContain("__typename: leafField<'__typename', ['!'], string>('__typename', ['!'])");
    // ...and a concrete object type still gets its own single literal name.
    expect(src).toContain("__typename: leafField<'__typename', ['!'], 'Dog'>('__typename', ['!'])");
  });

  it('emits the renamed builder family', async () => {
    const src = await generated();
    expect(src).toContain('import {\n  argSpec,');
    expect(src).toContain('leafField<');
    expect(src).toContain("objectField('");
    // All five old generic names must be gone. The three patterns below each anchor on
    // the punctuation that used to follow the name, so none of them says anything about
    // `leafArgs` / `objectArgs` — and `\b` does not match between `f` and `A`, so a revert
    // of those two to their old names slips past all three untouched. They get their own
    // assertion below.
    //
    // That assertion's closing `\b` is NOT what spares the current `leafFieldArgs` /
    // `objectFieldArgs`: those do not contain `leafArgs`/`objectArgs` as substrings at
    // all, so they could never match either way. Its only real effect is to exclude a
    // hypothetical future suffixed name such as `leafArgsSpec`.
    expect(src).not.toMatch(/\bobject\(/);
    expect(src).not.toMatch(/\bleaf</);
    expect(src).not.toMatch(/\bargs</);
    expect(src).not.toMatch(/\bleafArgs\b|\bobjectArgs\b/);
  });

  /** The SDL fixture has no custom scalar, so prelude cases build the IR with overrides. */
  async function generatedWith(overrides: Record<string, ScalarConfig>) {
    return emit(buildIR(await loadSchema(sdlPath), resolveScalars(overrides)));
  }

  it('emits nothing extra when no scalar contributes a prelude', async () => {
    // Pins the byte-identical-by-default promise: a config that only uses the string form
    // must produce exactly what buildql produced before the object form existed.
    expect(await generatedWith({ ID: 'string' })).toBe(await generated());
    // The assertion above cannot catch an unconditional `parts.push(prelude)`: an empty
    // prelude would add the same blank line to both sides. This one can — it pins the exact
    // bytes where the prelude would land if it were ever pushed empty.
    expect(await generated()).toContain("} from 'buildql';\n\nexport const Query = {");
  });

  it('emits a type-only import for an imported scalar type', async () => {
    const src = await generatedWith({ ID: { name: 'PostId', from: '../types/ids' } });
    expect(src).toContain("import type { PostId } from '../types/ids';");
    // Type-only, so the generated module carries no runtime dependency on the user's module —
    // which is what lets it be published as a package with the types in devDependencies.
    expect(src).not.toContain('import { PostId }');
  });

  it('exports a declared scalar type so consumers can name it', async () => {
    const src = await generatedWith({ ID: { name: 'PostId', declare: 'string & { __brand: "post" }' } });
    expect(src).toContain('export type PostId = string & { __brand: "post" };');
  });

  it('groups imports by module and sorts both groups and names', async () => {
    const src = await generatedWith({
      ID: { name: 'Zed', from: 'z-pkg' },
      String: { name: 'Beta', from: 'a-pkg' },
      Int: { name: 'Alpha', from: 'a-pkg' },
    });
    expect(src).toContain("import type { Alpha, Beta } from 'a-pkg';\nimport type { Zed } from 'z-pkg';");
  });

  it('places the prelude after the runtime import and before the generated types', async () => {
    const src = await generatedWith({ ID: { name: 'PostId', from: '../types/ids' } });
    expect(src.indexOf("from 'buildql'")).toBeLessThan(src.indexOf("from '../types/ids'"));
    expect(src.indexOf("from '../types/ids'")).toBeLessThan(src.indexOf('export const Post = {'));
  });

  it('uses the mapped scalar types in both positions in the generated module', async () => {
    const src = await generatedWith({ ID: { input: 'string | number', output: 'string' } });
    expect(src).toContain("id: leafField<'id', ['!'], string>('id', ['!'])");
    // Parenthesised: `inputTsType`'s atomicity guard wraps any non-atomic base
    // unconditionally (see ts-types.ts and its test), independent of whether a `[]`
    // ever lands on it — a deliberate, already-pinned decision from Task 4 (ff077dc),
    // not something this task changes.
    expect(src).toContain("argSpec<{ id: (string | number) }>({ id: 'ID!' })");
  });

  it('throws when a scalar type name collides with a generated schema type', async () => {
    await expect(generatedWith({ ID: { name: 'Post', declare: 'string' } })).rejects.toThrow(
      /buildql: a "scalars" entry maps to a TypeScript type named "Post"/,
    );
  });

  it('throws when a scalar type name collides with a fragment helper', async () => {
    await expect(generatedWith({ ID: { name: 'postFragment', declare: 'string' } })).rejects.toThrow(
      /named "postFragment"/,
    );
  });

  it('throws when a scalar type name collides with a runtime import', async () => {
    await expect(generatedWith({ ID: { name: 'leafField', from: 'pkg' } })).rejects.toThrow(
      /named "leafField"/,
    );
  });
});

describe('unmappedScalars', () => {
  const schema: IRSchema = {
    queryType: 'Query',
    mutationType: null,
    subscriptionType: null,
    scalars: DEFAULT_SCALAR_MAPPINGS,
    scalarPrelude: EMPTY_SCALAR_PRELUDE,
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
      {
        name: 'DateTime',
        kind: 'scalar',
        description: null,
        possibleTypes: [],
        interfaces: [],
        enumValues: [],
        inputFields: [],
        fields: [],
      },
      {
        name: 'JSON',
        kind: 'scalar',
        description: null,
        possibleTypes: [],
        interfaces: [],
        enumValues: [],
        inputFields: [],
        fields: [],
      },
      {
        name: 'String',
        kind: 'scalar',
        description: null,
        possibleTypes: [],
        interfaces: [],
        enumValues: [],
        inputFields: [],
        fields: [],
      },
    ],
  };

  it('names every custom scalar with no entry in ir.scalars', () => {
    expect(unmappedScalars(schema)).toEqual(['DateTime', 'JSON']);
  });

  it('does not flag scalars covered by the default or configured mapping', () => {
    const mapped: IRSchema = {
      ...schema,
      scalars: {
        ...DEFAULT_SCALAR_MAPPINGS,
        DateTime: { input: 'string', output: 'string' },
        JSON: { input: 'unknown', output: 'unknown' },
      },
    };
    expect(unmappedScalars(mapped)).toEqual([]);
  });

  it('flags a scalar named "toString" as unmapped, even though `name in scalars` would resolve it via Object.prototype', () => {
    // Regression test: `scalars` here is a plain object (as `DEFAULT_SCALAR_MAPPINGS` is), so
    // it inherits `toString`/`valueOf`/`constructor` from `Object.prototype`. A
    // membership check using `in` (rather than `Object.hasOwn`) would treat those
    // names as "mapped" and never flag them.
    const withProtoNamedScalar: IRSchema = {
      ...schema,
      types: [
        ...schema.types,
        {
          name: 'toString',
          kind: 'scalar',
          description: null,
          possibleTypes: [],
          interfaces: [],
          enumValues: [],
          inputFields: [],
          fields: [],
        },
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
      'import {\n  argSpec,\n  createClient,\n  include,\n  leafField,\n  leafFieldArgs,\n  makeFragment,\n' +
        '  makeMutation,\n  makeQuery,\n  makeSubscription,\n  objectField,\n  objectFieldArgs,\n  on,\n' +
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
