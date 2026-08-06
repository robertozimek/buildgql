import { expect, it } from 'vitest';
import { argSpec, leafField, leafFieldArgs, objectField } from '../../src/runtime/builders.js';
import { makeFragment, spread } from '../../src/runtime/fragment.js';
import { makeQuery } from '../../src/runtime/operation.js';
import { $ } from '../../src/runtime/var.js';

const User = {
  id: leafField<'id', ['!'], string>('id', ['!']),
  firstName: leafField<'firstName', ['!'], string>('firstName', ['!']),
  avatar: leafFieldArgs<'avatar', ['!'], string, { size: number }>(
    'avatar',
    ['!'],
    argSpec<{ size: number }>({ size: 'Int!' }),
  ),
};
const Query = { users: objectField('users', ['!', 'l', '!'], User) };
const userFragment = makeFragment('User', User);
const query = makeQuery(Query);

it('emits a fragment definition and a spread', () => {
  const Bits = userFragment('Bits', (U) => [U.firstName]);
  const q = query('Users', ($, Q) => [Q.users((U) => [U.id, spread(Bits)])]);
  expect(q.document).toBe('query Users { users { id ...Bits } } fragment Bits on User { firstName }');
});

it('emits a reused fragment only once', () => {
  const Bits = userFragment('Bits', (U) => [U.firstName]);
  const q = query('Users', ($, Q) => [
    Q.users((U) => [spread(Bits)]),
    Q.users.as('again')((U) => [spread(Bits)]),
  ]);
  expect(q.document.match(/fragment Bits on User/g)).toHaveLength(1);
});

it('emits fragments nested inside other fragments', () => {
  const Inner = userFragment('Inner', (U) => [U.firstName]);
  const Outer = userFragment('Outer', (U) => [U.id, spread(Inner)]);
  const q = query('Users', ($, Q) => [Q.users((U) => [spread(Outer)])]);
  expect(q.document).toContain('fragment Inner on User { firstName }');
  expect(q.document).toContain('fragment Outer on User { id ...Inner }');
});

it('hoists a variable used only inside a spread fragment into the operation signature', () => {
  const Bits = userFragment('Bits', (U) => [U.avatar({ size: $.size })]);
  const q = query('Users', ($, Q) => [Q.users((U) => [spread(Bits)])]);
  expect(q.document).toBe(
    'query Users($size: Int!) { users { ...Bits } } fragment Bits on User { avatar(size: $size) }',
  );
});

it('throws when two distinct fragments share a name', () => {
  const Same1 = userFragment('Same', (U) => [U.id]);
  const Same2 = userFragment('Same', (U) => [U.firstName]);
  expect(() =>
    query('Both', ($, Q) => [Q.users((U) => [spread(Same1)]), Q.users.as('again')((U) => [spread(Same2)])]),
  ).toThrow(/buildql: two different fragments are both named "Same"/);
});

it('reusing the same fragment handle twice does not throw and emits one definition', () => {
  const Bits = userFragment('Bits', (U) => [U.firstName]);
  let q!: ReturnType<typeof query>;
  expect(() => {
    q = query('Users', ($, Q) => [
      Q.users((U) => [spread(Bits)]),
      Q.users.as('again')((U) => [spread(Bits)]),
    ]);
  }).not.toThrow();
  expect(q.document.match(/fragment Bits on User/g)).toHaveLength(1);
});
