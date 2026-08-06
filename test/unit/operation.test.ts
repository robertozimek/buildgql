import { expect, it } from 'vitest';
import { argSpec, leafField, objectField, objectFieldArgs } from '../../src/runtime/builders.js';
import { makeMutation, makeQuery } from '../../src/runtime/operation.js';
import { $ } from '../../src/runtime/var.js';

const User = { id: leafField<'id', ['!'], string>('id', ['!']) };
const Query = { posts: objectField('posts', ['!', 'l', '!'], User) };
const Mutation = {
  createUser: objectFieldArgs('createUser', ['!'], User, argSpec<{ name: string }>({ name: 'String!' })),
};

it('builds a query document', () => {
  const q = makeQuery(Query)('Posts', ($, Q) => [Q.posts((U) => [U.id])]);
  expect(q.kind).toBe('query');
  expect(q.name).toBe('Posts');
  expect(q.document).toBe('query Posts { posts { id } }');
});

it('builds a mutation document with hoisted variables', () => {
  const m = makeMutation(Mutation)('CreateNewUser', ($, M) => [
    M.createUser({ name: $.name }, (U) => [U.id]),
  ]);
  expect(m.document).toBe('mutation CreateNewUser($name: String!) { createUser(name: $name) { id } }');
});
