import { leaf, object } from '../../src/runtime/builders.js';
import { include, skip } from '../../src/runtime/directives.js';
import { makeQuery } from '../../src/runtime/operation.js';
import { v } from '../../src/runtime/var.js';
import type { RESULT, VARS } from '../../src/types/symbols.js';

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const User = {
  id: leaf<'id', ['!'], string>('id', ['!']),
  bio: leaf<'bio', ['!'], string>('bio', ['!']),
  email: leaf<'email', ['!'], string>('email', ['!']),
};
const query = makeQuery({ me: object('me', ['!'], User) });

const q = query('Me', ($, Q) => [
  Q.me((U) => [U.id, include(U.bio, v('withBio')), skip(U.email, v('hideEmail'))]),
]);

// conditionally-selected fields are optional in the result
type _1 = Expect<
  Eq<NonNullable<(typeof q)[typeof RESULT]>, { me: { id: string; bio?: string; email?: string } }>
>;

// the directive's condition becomes a Boolean! variable
type _2 = Expect<Eq<NonNullable<(typeof q)[typeof VARS]>, { withBio: boolean; hideEmail: boolean }>>;

export { q };
