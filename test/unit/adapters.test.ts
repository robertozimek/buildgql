import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  argSpec,
  leafField,
  leafFieldArgs,
  objectField,
  objectFieldArgs,
} from '../../src/runtime/builders.js';
import { makeMutation, makeQuery, makeSubscription } from '../../src/runtime/operation.js';
import { toDocument } from '../../src/adapters/document.js';
import { apolloDocument, toApolloMutation, toApolloQuery } from '../../src/adapters/apollo.js';
import { toUrqlArgs, urqlDocument } from '../../src/adapters/urql.js';
import { CLIENT_EMITS, CLIENT_KINDS } from '../../src/codegen/clients.js';

const User = {
  id: leafField<'id', ['!'], string>('id', ['!']),
  firstName: leafField<'firstName', ['!'], string>('firstName', ['!']),
};

// Not exported: the curried builder functions' inferred types reach an unexported
// symbol (VARS from src/types/select.ts), which trips TS4023 ("has or is using name ...
// but cannot be named") once this file is declaration-checked by `npm run test:types`.
// Only the resulting Operation values below need to be visible to later appended tests.
const query = makeQuery({
  users: objectField('users', ['!', 'l', '!'], User),
  user: objectFieldArgs('user', ['!'], User, argSpec<{ id: string }>({ id: 'ID!' })),
});
const mutation = makeMutation({
  createUser: objectFieldArgs('createUser', ['!'], User, argSpec<{ name: string }>({ name: 'String!' })),
});
const subscription = makeSubscription({
  ticks: leafFieldArgs<'ticks', ['!'], string, { room?: string }>(
    'ticks',
    ['!'],
    argSpec<{ room?: string }>({ room: 'String' }),
  ),
});

export const Users = query('Users', ($, Q) => [Q.users((U) => [U.id])]);
export const UserById = query('UserById', ($, Q) => [Q.user({ id: $.id }, (U) => [U.id])]);
export const CreateUser = mutation('CreateUser', ($, M) => [M.createUser({ name: $.name }, (U) => [U.id])]);
export const Ticks = subscription('Ticks', ($, S) => [S.ticks({ room: $.room })]);

describe('toDocument', () => {
  it('parses the operation document into a GraphQL AST', () => {
    const doc = toDocument(Users);
    expect(doc.kind).toBe('Document');
    expect(doc.definitions).toHaveLength(1);
    expect(doc.definitions[0]!.kind).toBe('OperationDefinition');
  });

  it('preserves the operation name and kind', () => {
    const def = toDocument(CreateUser).definitions[0]! as { name?: { value: string }; operation?: string };
    expect(def.name?.value).toBe('CreateUser');
    expect(def.operation).toBe('mutation');
  });

  it('returns the very same AST object on repeated calls', () => {
    // Apollo and urql key their caches on document identity — re-parsing on every
    // render would silently defeat both, so the WeakMap is load-bearing, not a
    // micro-optimisation.
    expect(toDocument(Users)).toBe(toDocument(Users));
  });

  it('returns distinct ASTs for distinct operations', () => {
    expect(toDocument(Users)).not.toBe(toDocument(UserById));
  });
});

describe('apollo adapter', () => {
  it('apolloDocument returns the shared, memoised AST', () => {
    expect(apolloDocument(Users)).toBe(toDocument(Users));
  });

  it('toApolloQuery produces client.query() options', () => {
    const opts = toApolloQuery(UserById, { id: '7' });
    expect(opts).toEqual({ query: toDocument(UserById), variables: { id: '7' } });
  });

  it('defaults variables to an empty object when the operation declares none', () => {
    // Matches `client.execute`, which also sends `variables: {}` rather than omitting
    // the key — Apollo uses `variables` for cache keying, and `undefined` vs `{}` would
    // make buildql's two client paths disagree about the same operation.
    expect(toApolloQuery(Users).variables).toEqual({});
  });

  it('toApolloQuery accepts a subscription, since client.subscribe() also takes { query }', () => {
    expect(toApolloQuery(Ticks, { room: 'lobby' }).query).toBe(toDocument(Ticks));
  });

  it('toApolloMutation produces client.mutate() options under the `mutation` key', () => {
    const opts = toApolloMutation(CreateUser, { name: 'Ada' });
    expect(opts).toEqual({ mutation: toDocument(CreateUser), variables: { name: 'Ada' } });
  });

  it('rejects a query passed to toApolloMutation', () => {
    expect(() => toApolloMutation(Users as never)).toThrow(
      /buildql: toApolloMutation\(\) expects a mutation operation, but "Users" is a query/,
    );
  });

  it('rejects a mutation passed to toApolloQuery', () => {
    expect(() => toApolloQuery(CreateUser as never)).toThrow(
      /buildql: toApolloQuery\(\) expects a query or subscription operation, but "CreateUser" is a mutation/,
    );
  });
});

describe('urql adapter', () => {
  it('urqlDocument returns the shared, memoised AST', () => {
    expect(urqlDocument(Users)).toBe(toDocument(Users));
  });

  it('toUrqlArgs produces useQuery() arguments', () => {
    expect(toUrqlArgs(UserById, { id: '7' })).toEqual({
      query: toDocument(UserById),
      variables: { id: '7' },
    });
  });

  it('defaults variables to an empty object', () => {
    expect(toUrqlArgs(Users).variables).toEqual({});
  });

  it('accepts every operation kind — urqlDocument is kind-agnostic', () => {
    // urql's *document* parameter (unlike Apollo's, which is wrapped in a kind-specific
    // `{ query }`/`{ mutation }` options object) takes any operation kind directly, so
    // `urqlDocument` works for all three and there is nothing a kind guard could catch here.
    expect(toUrqlArgs(CreateUser, { name: 'Ada' }).query).toBe(toDocument(CreateUser));
    expect(toUrqlArgs(Ticks).query).toBe(toDocument(Ticks));
  });
});

describe('client registry', () => {
  it('the client registry matches each adapter module and the published export map', async () => {
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    for (const kind of CLIENT_KINDS) {
      const { module, names } = CLIENT_EMITS[kind];
      if (!module || module === 'buildql') continue;
      const subpath = module.replace('buildql', '.');
      expect(pkg.exports[subpath], `${module} is not in package.json exports`).toBeDefined();
      const typesKey = subpath.slice(2);
      expect(pkg.typesVersions['*'][typesKey]).toBeDefined();
      // Vite's static analysis rewrites a template literal directly inside `import()` into
      // a glob lookup, which fails here because the path is only known at test-run time. A
      // plain variable computed beforehand bypasses that analysis and reaches Node's loader
      // unchanged.
      const adapterName = typesKey.split('/').pop()!;
      const modUrl = new URL(`../../src/adapters/${adapterName}.js`, import.meta.url).href;
      const mod = (await import(modUrl)) as Record<string, unknown>;
      expect(Object.keys(mod).sort()).toEqual([...names].sort());
    }
  });
});
