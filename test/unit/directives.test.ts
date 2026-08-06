import { expect, it } from 'vitest';
import { leafField, objectField } from '../../src/runtime/builders.js';
import { include, skip } from '../../src/runtime/directives.js';
import { makeQuery } from '../../src/runtime/operation.js';
import { $, v } from '../../src/runtime/var.js';

const User = {
  id: leafField<'id', ['!'], string>('id', ['!']),
  bio: leafField<'bio', ['!'], string>('bio', ['!']),
};
const query = makeQuery({ me: objectField('me', ['!'], User) });

it('prints @include with a variable and hoists it as Boolean!', () => {
  const q = query('Me', ($, Q) => [Q.me((U) => [U.id, include(U.bio, v('withBio'))])]);
  expect(q.document).toBe('query Me($withBio: Boolean!) { me { id bio @include(if: $withBio) } }');
});

it('prints @skip with a literal condition and hoists nothing', () => {
  const q = query('Me', ($, Q) => [Q.me((U) => [U.id, skip(U.bio, true)])]);
  expect(q.document).toBe('query Me { me { id bio @skip(if: true) } }');
});

it('rejects a $ marker because directives have no argument key to name the variable after', () => {
  expect(() => include(User.bio, $.withBio)).toThrow(/v\(/);
});
