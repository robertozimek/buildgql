import { leafField, objectField } from '../../src/runtime/builders.js';
import { include, skip } from '../../src/runtime/directives.js';
import { makeQuery } from '../../src/runtime/operation.js';
import { v } from '../../src/runtime/var.js';
import type { RESULT, VARS } from '../../src/types/symbols.js';

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const User = {
  id: leafField<'id', ['!'], string>('id', ['!']),
  bio: leafField<'bio', ['!'], string>('bio', ['!']),
  email: leafField<'email', ['!'], string>('email', ['!']),
};
const query = makeQuery({ me: objectField('me', ['!'], User) });

const q = query('Me', ($, Q) => [
  Q.me((U) => [U.id, include(U.bio, v('withBio')), skip(U.email, v('hideEmail'))]),
]);

// conditionally-selected fields are optional in the result
type _1 = Expect<
  Eq<NonNullable<(typeof q)[typeof RESULT]>, { me: { id: string; bio?: string; email?: string } }>
>;

// the directive's condition becomes a Boolean! variable
type _2 = Expect<Eq<NonNullable<(typeof q)[typeof VARS]>, { withBio: boolean; hideEmail: boolean }>>;

// a literal condition on the directive still makes the result field optional
const qLiteral = query('Literal', ($, Q) => [
  Q.me((U) => [U.id, skip(U.bio, true), include(U.email, v('lang'))]),
]);

type _3 = Expect<
  Eq<NonNullable<(typeof qLiteral)[typeof RESULT]>, { me: { id: string; bio?: string; email?: string } }>
>;

// regression guard for the `include`/`skip` overload split: a literal condition
// must contribute NO variable. With the old single-signature declaration,
// `Name` was unconstrained by a literal `true`, so TS inferred `Name = string`
// and `{ [P in Name]: boolean }` became an index signature — `skip(U.bio, true)`
// would then widen VARS to `{ [x: string]: boolean; lang: boolean }` instead of
// `{ lang: boolean }`, and `Eq` (unlike a plain `extends` check) tells the two
// apart, so this assertion fails against the old code.
type _4 = Expect<Eq<NonNullable<(typeof qLiteral)[typeof VARS]>, { lang: boolean }>>;

export { q, qLiteral };
