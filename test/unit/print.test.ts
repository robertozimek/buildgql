import { describe, expect, it } from 'vitest';
import { args, leaf, object, objectArgs } from '../../src/runtime/builders.js';
import { $, v } from '../../src/runtime/var.js';
import { printOperation } from '../../src/runtime/print.js';

const User = {
  id: leaf<'id', ['!'], string>('id', ['!']),
  firstName: leaf<'firstName', ['!'], string>('firstName', ['!']),
  lastName: leaf<'lastName', [], string>('lastName', []),
};
const Post = {
  id: leaf<'id', ['!'], string>('id', ['!']),
  title: leaf<'title', ['!'], string>('title', ['!']),
  author: object('author', ['!'], User),
};
const Root = {
  posts: object('posts', ['!', 'l', '!'], Post),
  createUser: objectArgs(
    'createUser',
    ['!'],
    User,
    args<{ name: string; email: string }>({ name: 'String!', email: 'String!' }),
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
      a: objectArgs('a', ['!'], User, args<{ x: string }>({ x: 'String!' })),
      b: objectArgs('b', ['!'], User, args<{ x: number }>({ x: 'Int!' })),
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
      f: objectArgs('f', ['!'], User, args<{ where: { ids: string[]; ok: boolean } }>({ where: 'Filter!' })),
    };
    const doc = printOperation('query', 'Q', [F.f({ where: { ids: ['a', 'b'], ok: true } }, (U) => [U.id])]);
    expect(doc).toBe('query Q { f(where: {ids: ["a", "b"], ok: true}) { id } }');
  });

  it('prints enum literals unquoted and strings quoted', () => {
    const F = {
      f: objectArgs(
        'f',
        ['!'],
        User,
        args<{ status: 'ACTIVE' | 'BANNED'; name: string }>({ status: 'Status!', name: 'String!' }, [
          'status',
        ]),
      ),
    };
    const doc = printOperation('query', 'Q', [F.f({ status: 'ACTIVE', name: 'Ada' }, (U) => [U.id])]);
    expect(doc).toBe('query Q { f(status: ACTIVE, name: "Ada") { id } }');
  });
});
