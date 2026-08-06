import { leaf, object } from '../../src/runtime/builders.js';
import { makeFragment, spread } from '../../src/runtime/fragment.js';
import { makeQuery } from '../../src/runtime/operation.js';
import type { RESULT } from '../../src/types/symbols.js';

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const User = {
  id: leaf<'id', ['!'], string>('id', ['!']),
  firstName: leaf<'firstName', ['!'], string>('firstName', ['!']),
  lastName: leaf<'lastName', [], string>('lastName', []),
};
const Query = { users: object('users', ['!', 'l', '!'], User) };
const userFragment = makeFragment('User', User);
const query = makeQuery(Query);

const NameBits = userFragment('NameBits', (U) => [U.firstName, U.lastName]);

// spread merges into the parent object, it does not nest
const q = query('Users', ($, Q) => [Q.users((U) => [U.id, spread(NameBits)])]);
type _1 = Expect<
  Eq<
    NonNullable<(typeof q)[typeof RESULT]>,
    { users: { id: string; firstName: string; lastName: string | null }[] }
  >
>;

// the same fragment reused elsewhere keeps its type
const q2 = query('Users2', ($, Q) => [Q.users((U) => [spread(NameBits)])]);
type _2 = Expect<
  Eq<NonNullable<(typeof q2)[typeof RESULT]>, { users: { firstName: string; lastName: string | null }[] }>
>;

export { q, q2 };
