import { describe, expect, it } from 'vitest';
import { args, leaf, leafArgs, object, objectArgs } from '../../src/runtime/builders.js';
import { makeMutation, makeQuery, makeSubscription } from '../../src/runtime/operation.js';
import { toDocument } from '../../src/adapters/document.js';
import { apolloDocument, toApolloMutation, toApolloQuery } from '../../src/adapters/apollo.js';

const User = {
  id: leaf<'id', ['!'], string>('id', ['!']),
  firstName: leaf<'firstName', ['!'], string>('firstName', ['!']),
};

// Not exported: the curried builder functions' inferred types reach an unexported
// symbol (VARS from src/types/select.ts), which trips TS4023 ("has or is using name ...
// but cannot be named") once this file is declaration-checked by `npm run test:types`.
// Only the resulting Operation values below need to be visible to later appended tests.
const query = makeQuery({
  users: object('users', ['!', 'l', '!'], User),
  user: objectArgs('user', ['!'], User, args<{ id: string }>({ id: 'ID!' })),
});
const mutation = makeMutation({
  createUser: objectArgs(
    'createUser',
    ['!'],
    User,
    args<{ name: string }>({ name: 'String!' }),
  ),
});
const subscription = makeSubscription({
  ticks: leafArgs<'ticks', ['!'], string, { room?: string }>(
    'ticks',
    ['!'],
    args<{ room?: string }>({ room: 'String' }),
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
