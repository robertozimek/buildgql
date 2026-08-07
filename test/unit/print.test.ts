import { describe, expect, it } from 'vitest';
import {
  argSpec,
  leafField,
  leafFieldArgs,
  objectField,
  objectFieldArgs,
} from '../../src/runtime/builders.js';
import { $, v } from '../../src/runtime/var.js';
import { printOperation } from '../../src/runtime/print.js';
import { makeQuery } from '../../src/runtime/operation.js';

const User = {
  id: leafField<'id', ['!'], string>('id', ['!']),
  firstName: leafField<'firstName', ['!'], string>('firstName', ['!']),
  lastName: leafField<'lastName', [], string>('lastName', []),
};
const Post = {
  id: leafField<'id', ['!'], string>('id', ['!']),
  title: leafField<'title', ['!'], string>('title', ['!']),
  author: objectField('author', ['!'], User),
};
const Root = {
  posts: objectField('posts', ['!', 'l', '!'], Post),
  createUser: objectFieldArgs(
    'createUser',
    ['!'],
    User,
    argSpec<{ name: string; email: string }>({ name: 'String!', email: 'String!' }),
  ),
};

describe('printOperation', () => {
  it('prints a nested query', () => {
    const doc = printOperation('query', 'Posts', [
      Root.posts((P) => [P.id, P.title, P.author((A) => [A.id, A.firstName, A.lastName])]),
    ]);
    expect(doc).toBe('query Posts { posts { id title author { id firstName lastName } } }');
  });

  it('prints aliases', () => {
    const doc = printOperation('query', 'Aliased', [Root.posts((P) => [P.id.as('postId')])]);
    expect(doc).toBe('query Aliased { posts { postId: id } }');
  });

  it('hoists variables into the operation signature', () => {
    const doc = printOperation('mutation', 'CreateNewUser', [
      Root.createUser({ name: $.name, email: $.email }, (U) => [U.id]),
    ]);
    expect(doc).toBe(
      'mutation CreateNewUser($name: String!, $email: String!) { createUser(name: $name, email: $email) { id } }',
    );
  });

  it('inlines literal arguments', () => {
    const doc = printOperation('mutation', 'M', [
      Root.createUser({ name: 'John', email: 'j@s.com' }, (U) => [U.id]),
    ]);
    expect(doc).toBe('mutation M { createUser(name: "John", email: "j@s.com") { id } }');
  });

  it('uses explicit variable names', () => {
    const doc = printOperation('mutation', 'M', [
      Root.createUser({ name: v('userName'), email: 'e' }, (U) => [U.id]),
    ]);
    expect(doc).toBe('mutation M($userName: String!) { createUser(name: $userName, email: "e") { id } }');
  });

  it('deduplicates a variable used twice', () => {
    const doc = printOperation('mutation', 'M', [
      Root.createUser({ name: v('n'), email: 'a' }, (U) => [U.id]),
      Root.createUser.as('second')({ name: v('n'), email: 'b' }, (U) => [U.id]),
    ]);
    expect(doc.startsWith('mutation M($n: String!) {')).toBe(true);
  });

  it('rejects a variable name used with two different types', () => {
    const Mixed = {
      a: objectFieldArgs('a', ['!'], User, argSpec<{ x: string }>({ x: 'String!' })),
      b: objectFieldArgs('b', ['!'], User, argSpec<{ x: number }>({ x: 'Int!' })),
    };
    expect(() =>
      printOperation('query', 'Bad', [
        Mixed.a({ x: v('x') }, (U) => [U.id]),
        Mixed.b({ x: v('x') }, (U) => [U.id]),
      ]),
    ).toThrow(/\$x.*String!.*Int!.*v\(/s);
  });

  it('serialises object and list literals', () => {
    const F = {
      f: objectFieldArgs(
        'f',
        ['!'],
        User,
        argSpec<{ where: { ids: string[]; ok: boolean } }>({ where: 'Filter!' }),
      ),
    };
    const doc = printOperation('query', 'Q', [F.f({ where: { ids: ['a', 'b'], ok: true } }, (U) => [U.id])]);
    expect(doc).toBe('query Q { f(where: {ids: ["a", "b"], ok: true}) { id } }');
  });

  it('prints enum literals unquoted and strings quoted', () => {
    const F = {
      f: objectFieldArgs(
        'f',
        ['!'],
        User,
        argSpec<{ status: 'ACTIVE' | 'BANNED'; name: string }>({ status: 'Status!', name: 'String!' }, [
          'status',
        ]),
      ),
    };
    const doc = printOperation('query', 'Q', [F.f({ status: 'ACTIVE', name: 'Ada' }, (U) => [U.id])]);
    expect(doc).toBe('query Q { f(status: ACTIVE, name: "Ada") { id } }');
  });

  it('does not mistake a user input object with a __enum key for an enum value', () => {
    const Root = {
      search: leafFieldArgs<'search', ['!'], string, { filter: { __enum: string } }>(
        'search',
        ['!'],
        argSpec<{ filter: { __enum: string } }>({ filter: 'FilterInput!' }),
      ),
    };
    const q = makeQuery(Root)('Search', (_$, R) => [R.search({ filter: { __enum: 'NOT_AN_ENUM' } })]);
    expect(q.document).toContain('{__enum: "NOT_AN_ENUM"}');
    expect(q.document).not.toContain('filter: NOT_AN_ENUM');
  });

  it('does not mistake a user input object with a __varRef key for a variable', () => {
    const Root = {
      search: leafFieldArgs<'search', ['!'], string, { filter: { __varRef: string } }>(
        'search',
        ['!'],
        argSpec<{ filter: { __varRef: string } }>({ filter: 'FilterInput!' }),
      ),
    };
    const q = makeQuery(Root)('Search', (_$, R) => [R.search({ filter: { __varRef: 'nope' } })]);
    expect(q.document).toContain('{__varRef: "nope"}');
    expect(q.document).not.toContain('$nope');
  });
});
