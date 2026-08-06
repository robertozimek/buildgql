import { args, leaf, object, objectArgs } from '../../src/runtime/builders.js';
import { makeMutation, makeQuery } from '../../src/runtime/operation.js';
import { $ } from '../../src/runtime/var.js';
import type { RESULT, VARS } from '../../src/types/symbols.js';

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

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
const Query = { posts: object('posts', ['!', 'l', '!'], Post) };
const Mutation = {
  createUser: objectArgs(
    'createUser',
    ['!'],
    User,
    args<{ name: string; email: string }>({ name: 'String!', email: 'String!' }),
  ),
};

const query = makeQuery(Query);
const mutation = makeMutation(Mutation);

const q = query('Posts', ($, Q) => [Q.posts((P) => [P.id, P.title, P.author((A) => [A.id, A.lastName])])]);
type _1 = Expect<
  Eq<
    NonNullable<(typeof q)[typeof RESULT]>,
    { posts: { id: string; title: string; author: { id: string; lastName: string | null } }[] }
  >
>;
type _2 = Expect<Eq<NonNullable<(typeof q)[typeof VARS]>, {}>>;

const m = mutation('CreateNewUser', ($, M) => [
  M.createUser({ name: $.name, email: $.email }, (U) => [U.id, U.firstName]),
]);
type _3 = Expect<Eq<NonNullable<(typeof m)[typeof VARS]>, { name: string; email: string }>>;
type _4 = Expect<
  Eq<NonNullable<(typeof m)[typeof RESULT]>, { createUser: { id: string; firstName: string } }>
>;

export { q, m };
